import { createHash } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import {
    DeleteObjectCommand,
    GetObjectCommand,
    type GetObjectCommandOutput,
    HeadObjectCommand,
    ListObjectsV2Command,
    S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
    APP_MIN_DATASET_SCHEMA_VERSION,
    ARTIFACT_SCHEMA_VERSION,
    assertDatasetBuildMetadata,
    assertDatasetManifest,
    CHUNK_SCHEMA_VERSION,
    DATASET_SCHEMA_VERSION,
    type DatasetArtifactDescriptor,
    type DatasetBuildMetadata,
    type DatasetManifest,
} from '../src/lib/datasetManifest';
import {
    assertDatasetPointer,
    type DatasetChannel,
    type DatasetPointer,
    getDatasetPointerKey,
} from '../src/lib/datasetPointer';

const DEFAULT_BUILD_METADATA_PATH = join('tmp', 'dataset-build', 'metadata.json');
const DEFAULT_RESUME_STATE_DIR = join('tmp', 'publish-state');
const DEFAULT_MAX_CONCURRENCY = 8;
const JSON_CONTENT_TYPE = 'application/json';
const CHUNK_VERIFICATION_RANDOM_COUNT = 3;

type ObjectPayload = string | Uint8Array;

type ObjectHead = {
    key: string;
    bytes: number;
};

type ObjectBody = ObjectHead & {
    body: Uint8Array;
};

export type ObjectStore = {
    putObject(key: string, body: ObjectPayload, contentType: string): Promise<void>;
    getObject(key: string): Promise<ObjectBody | null>;
    headObject(key: string): Promise<ObjectHead | null>;
    listObjects(prefix: string): Promise<ObjectHead[]>;
    deleteObject(key: string): Promise<void>;
};

type PublishResumeState = {
    datasetVersion: string;
    uploadedKeys: string[];
    verifiedKeys: string[];
    manifestUploaded: boolean;
    updatedAt: string;
};

type DatasetHistoryRecord = DatasetPointer & {
    action: 'promote' | 'rollback';
    channel: DatasetChannel;
    previousDatasetVersion?: string;
    recordedAt: string;
};

type ChunkChecksumEntry = {
    key: string;
    bytes: number;
    sha256: string;
};

type IntegrityArtifact = {
    artifactSchemaVersion: number;
    datasetVersion: string;
    createdAt: string;
    entries: ChunkChecksumEntry[];
};

type PreparedObject = {
    key: string;
    bytes: number;
    contentType: string;
    sha256: string;
    body: Uint8Array;
    category: 'chunk' | 'bootstrap' | 'integrity';
};

type PreparedDataset = {
    datasetVersion: string;
    manifestKey: string;
    manifest: DatasetManifest;
    objects: PreparedObject[];
    verificationKeys: string[];
};

export type PublishDatasetOptions = {
    datasetVersion?: string;
    buildMetadataPath?: string;
    maxConcurrency?: number;
    stateDir?: string;
    simulateFailureAfter?: number;
};

export type PromoteDatasetOptions = {
    channel: DatasetChannel;
    datasetVersion: string;
    notes?: string;
};

export type RollbackDatasetOptions = PromoteDatasetOptions;

export type PruneDatasetsResult = {
    deletedDatasetVersions: string[];
    protectedDatasetVersions: string[];
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBytes = (value: ObjectPayload) => (typeof value === 'string' ? textEncoder.encode(value) : value);

const sha256Hex = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

const readJsonFile = async <T>(filePath: string) => {
    return (await Bun.file(filePath).json()) as T;
};

const writeJsonFile = async (filePath: string, value: unknown) => {
    await Bun.write(filePath, JSON.stringify(value, null, 2));
};

const readJsonObject = async <T>(store: ObjectStore, key: string) => {
    const object = await store.getObject(key);
    if (!object) {
        return null;
    }

    return JSON.parse(textDecoder.decode(object.body)) as T;
};

const listFiles = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFiles(fullPath)));
            continue;
        }
        files.push(fullPath);
    }
    return files;
};

const formatDatasetTimestamp = (value: Date) =>
    value
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replace(/:/g, '-');

export const generateDatasetVersion = (gitCommit: string, now = new Date()) => {
    const suffix = gitCommit.replace(/[^a-zA-Z0-9]/g, '').slice(0, 7) || 'nogit';
    return `${formatDatasetTimestamp(now)}-${suffix}`;
};

const getManifestKey = (datasetVersion: string) => `datasets/${datasetVersion}/manifest.json`;

const getHistoryKey = (channel: DatasetChannel, datasetVersion: string, timestamp: string) =>
    `channels/history/${channel}/${timestamp}-${datasetVersion}.json`;

const getResumeStatePath = (stateDir: string, datasetVersion: string) => join(stateDir, `${datasetVersion}.json`);

const loadResumeState = async (statePath: string, datasetVersion: string): Promise<PublishResumeState> => {
    if (!(await Bun.file(statePath).exists())) {
        return {
            datasetVersion,
            uploadedKeys: [],
            verifiedKeys: [],
            manifestUploaded: false,
            updatedAt: new Date(0).toISOString(),
        };
    }

    const parsed = (await readJsonFile<PublishResumeState>(statePath)) ?? {};
    return {
        datasetVersion,
        uploadedKeys: Array.isArray(parsed.uploadedKeys) ? parsed.uploadedKeys : [],
        verifiedKeys: Array.isArray(parsed.verifiedKeys) ? parsed.verifiedKeys : [],
        manifestUploaded: parsed.manifestUploaded === true,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    };
};

export const saveResumeState = async (statePath: string, state: PublishResumeState) => {
    await mkdir(dirname(statePath), { recursive: true });
    await writeJsonFile(statePath, {
        ...state,
        uploadedKeys: [...new Set(state.uploadedKeys)].sort(),
        verifiedKeys: [...new Set(state.verifiedKeys)].sort(),
        updatedAt: new Date().toISOString(),
    });
};

const pickRandomChunkKeys = (chunkKeys: string[], datasetVersion: string, count: number) => {
    const selected = new Set<string>();
    for (let index = 0; index < count; index++) {
        const digest = createHash('sha256').update(`${datasetVersion}:${index}`).digest('hex');
        const candidate = chunkKeys[parseInt(digest.slice(0, 8), 16) % chunkKeys.length];
        selected.add(candidate);
    }
    return [...selected];
};

export const selectChunkVerificationSampleKeys = (chunkKeys: string[], datasetVersion: string) => {
    if (chunkKeys.length === 0) {
        return [];
    }

    const selected = new Set<string>();
    selected.add(chunkKeys[0]);
    selected.add(chunkKeys[chunkKeys.length - 1]);

    for (const key of pickRandomChunkKeys(chunkKeys, datasetVersion, CHUNK_VERIFICATION_RANDOM_COUNT)) {
        selected.add(key);
    }

    return [...selected];
};

const buildIntegrityArtifact = (datasetVersion: string, entries: ChunkChecksumEntry[], createdAt: string) => {
    return {
        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
        datasetVersion,
        createdAt,
        entries,
    } satisfies IntegrityArtifact;
};

const buildArtifactDescriptor = (
    key: string,
    bytes: number,
    sha256: string,
    contentType = JSON_CONTENT_TYPE,
): DatasetArtifactDescriptor => ({
    key,
    bytes,
    sha256,
    contentType,
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
});

const prepareLocalDataset = async (
    buildMetadata: DatasetBuildMetadata,
    datasetVersion: string,
): Promise<PreparedDataset> => {
    const createdAt = buildMetadata.generatedAt;
    const datasetPrefix = `datasets/${datasetVersion}`;
    const bootstrapInputs = [
        {
            name: 'collections',
            localPath: buildMetadata.outputs.collectionsFile,
            remotePath: `${datasetPrefix}/artifacts/bootstrap/collections.json`,
        },
        {
            name: 'translators',
            localPath: buildMetadata.outputs.translatorsFile,
            remotePath: `${datasetPrefix}/artifacts/bootstrap/translators.json`,
        },
        {
            name: 'indexesFull',
            localPath: buildMetadata.outputs.indexesFile,
            remotePath: `${datasetPrefix}/artifacts/bootstrap/indexes.full.json`,
        },
    ] as const;

    const objects: PreparedObject[] = [];
    const chunkFiles = await listFiles(buildMetadata.outputs.chunksDir);
    const chunkChecksumEntries: ChunkChecksumEntry[] = [];

    for (const chunkPath of chunkFiles.sort()) {
        const body = new Uint8Array(await Bun.file(chunkPath).arrayBuffer());
        const key = `${datasetPrefix}/chunks/${relative(buildMetadata.outputs.chunksDir, chunkPath).replace(/\\/g, '/')}`;
        const sha256 = sha256Hex(body);
        objects.push({
            key,
            bytes: body.byteLength,
            contentType: JSON_CONTENT_TYPE,
            sha256,
            body,
            category: 'chunk',
        });
        chunkChecksumEntries.push({
            key,
            bytes: body.byteLength,
            sha256,
        });
    }

    for (const input of bootstrapInputs) {
        const body = new Uint8Array(await Bun.file(input.localPath).arrayBuffer());
        objects.push({
            key: input.remotePath,
            bytes: body.byteLength,
            contentType: JSON_CONTENT_TYPE,
            sha256: sha256Hex(body),
            body,
            category: 'bootstrap',
        });
    }

    const integrityArtifact = buildIntegrityArtifact(datasetVersion, chunkChecksumEntries, createdAt);
    const integrityBody = textEncoder.encode(JSON.stringify(integrityArtifact, null, 2));
    const integrityKey = `${datasetPrefix}/artifacts/integrity/chunks.json`;
    objects.push({
        key: integrityKey,
        bytes: integrityBody.byteLength,
        contentType: JSON_CONTENT_TYPE,
        sha256: sha256Hex(integrityBody),
        body: integrityBody,
        category: 'integrity',
    });

    const descriptorMap = new Map(
        objects.map((object) => [object.key, buildArtifactDescriptor(object.key, object.bytes, object.sha256)]),
    );
    const manifest = {
        datasetSchemaVersion: DATASET_SCHEMA_VERSION,
        chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
        appMinDatasetSchemaVersion: APP_MIN_DATASET_SCHEMA_VERSION,
        datasetVersion,
        createdAt,
        gitCommit: buildMetadata.gitCommit,
        sourceProvenance: buildMetadata.sourceProvenance,
        toolVersions: buildMetadata.toolVersions,
        artifactCounts: {
            chunks: chunkChecksumEntries.length,
            bootstrapArtifacts: bootstrapInputs.length,
            integrityArtifacts: 1,
            totalObjects: objects.length,
        },
        artifactBytes: {
            chunks: objects
                .filter((object) => object.category === 'chunk')
                .reduce((sum, object) => sum + object.bytes, 0),
            bootstrapArtifacts: objects
                .filter((object) => object.category === 'bootstrap')
                .reduce((sum, object) => sum + object.bytes, 0),
            integrityArtifacts: integrityBody.byteLength,
            total: objects.reduce((sum, object) => sum + object.bytes, 0),
        },
        runtimeArtifactSet: {
            bootstrap: {
                collections: descriptorMap.get(`${datasetPrefix}/artifacts/bootstrap/collections.json`)!,
                translators: descriptorMap.get(`${datasetPrefix}/artifacts/bootstrap/translators.json`)!,
                indexesFull: descriptorMap.get(`${datasetPrefix}/artifacts/bootstrap/indexes.full.json`)!,
            },
            integrity: {
                chunks: descriptorMap.get(integrityKey)!,
            },
        },
    } satisfies DatasetManifest;

    assertDatasetManifest(manifest);

    return {
        datasetVersion,
        manifestKey: getManifestKey(datasetVersion),
        manifest,
        objects,
        verificationKeys: [
            ...objects.filter((object) => object.category !== 'chunk').map((object) => object.key),
            ...selectChunkVerificationSampleKeys(
                objects.filter((object) => object.category === 'chunk').map((object) => object.key),
                datasetVersion,
            ),
        ],
    };
};

const verifyObject = async (store: ObjectStore, object: PreparedObject) => {
    const head = await store.headObject(object.key);
    if (!head || head.bytes !== object.bytes) {
        throw new Error(`Head verification failed for ${object.key}`);
    }

    const remote = await store.getObject(object.key);
    if (!remote) {
        throw new Error(`Missing object after upload: ${object.key}`);
    }

    if (sha256Hex(remote.body) !== object.sha256) {
        throw new Error(`Checksum mismatch for ${object.key}`);
    }
};

const runWithConcurrency = async <T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>,
) => {
    let cursor = 0;
    const runOne = async () => {
        while (cursor < items.length) {
            const currentIndex = cursor++;
            await worker(items[currentIndex], currentIndex);
        }
    };

    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, () => runOne()));
};

const readBuildMetadata = async (buildMetadataPath: string) => {
    return assertDatasetBuildMetadata(await readJsonFile<DatasetBuildMetadata>(buildMetadataPath));
};

export const prepareDatasetPublish = async (
    buildMetadataPath = DEFAULT_BUILD_METADATA_PATH,
    datasetVersion?: string,
) => {
    const buildMetadata = await readBuildMetadata(buildMetadataPath);
    const effectiveVersion = datasetVersion ?? generateDatasetVersion(buildMetadata.gitCommit);
    return prepareLocalDataset(buildMetadata, effectiveVersion);
};

export const publishDataset = async (store: ObjectStore, options: PublishDatasetOptions = {}) => {
    const prepared = await prepareDatasetPublish(options.buildMetadataPath, options.datasetVersion);
    const statePath = getResumeStatePath(options.stateDir ?? DEFAULT_RESUME_STATE_DIR, prepared.datasetVersion);
    const resumeState = await loadResumeState(statePath, prepared.datasetVersion);
    const uploadedKeys = new Set(resumeState.uploadedKeys);
    const verifiedKeys = new Set(resumeState.verifiedKeys);
    let persistedSinceFlush = 0;
    let successfulUploads = 0;

    const flushState = async (manifestUploaded = resumeState.manifestUploaded) => {
        await saveResumeState(statePath, {
            datasetVersion: prepared.datasetVersion,
            uploadedKeys: [...uploadedKeys],
            verifiedKeys: [...verifiedKeys],
            manifestUploaded,
            updatedAt: new Date().toISOString(),
        });
        persistedSinceFlush = 0;
    };

    const uploadableObjects = prepared.objects;
    await runWithConcurrency(uploadableObjects, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY, async (object) => {
        if (uploadedKeys.has(object.key)) {
            return;
        }

        const remote = await store.headObject(object.key);
        if (remote && remote.bytes === object.bytes) {
            const existing = await store.getObject(object.key);
            if (existing && sha256Hex(existing.body) === object.sha256) {
                uploadedKeys.add(object.key);
                return;
            }
        }

        await store.putObject(object.key, object.body, object.contentType);
        uploadedKeys.add(object.key);
        successfulUploads += 1;
        persistedSinceFlush += 1;

        if (options.simulateFailureAfter && successfulUploads >= options.simulateFailureAfter) {
            await flushState();
            throw new Error(`Simulated publish failure after ${successfulUploads} uploads`);
        }

        if (persistedSinceFlush >= 25) {
            await flushState();
        }
    });

    await flushState();

    for (const key of prepared.verificationKeys) {
        if (verifiedKeys.has(key)) {
            continue;
        }

        const object = prepared.objects.find((candidate) => candidate.key === key);
        if (!object) {
            throw new Error(`Missing prepared object for verification: ${key}`);
        }

        await verifyObject(store, object);
        verifiedKeys.add(key);
    }

    await flushState();

    const manifestBody = textEncoder.encode(JSON.stringify(prepared.manifest, null, 2));
    if (!resumeState.manifestUploaded) {
        await store.putObject(prepared.manifestKey, manifestBody, JSON_CONTENT_TYPE);
    }

    await saveResumeState(statePath, {
        datasetVersion: prepared.datasetVersion,
        uploadedKeys: [...uploadedKeys],
        verifiedKeys: [...verifiedKeys],
        manifestUploaded: true,
        updatedAt: new Date().toISOString(),
    });

    return {
        datasetVersion: prepared.datasetVersion,
        manifestKey: prepared.manifestKey,
        uploadedObjectCount: uploadedKeys.size + 1,
    };
};

const readManifestByVersion = async (store: ObjectStore, datasetVersion: string) => {
    const manifestKey = getManifestKey(datasetVersion);
    const manifest = await readJsonObject<DatasetManifest>(store, manifestKey);
    if (!manifest) {
        throw new Error(`Dataset manifest not found: ${manifestKey}`);
    }

    return { manifestKey, manifest: assertDatasetManifest(manifest) };
};

const getCurrentPointer = async (store: ObjectStore, channel: DatasetChannel) => {
    const pointer = await readJsonObject<DatasetPointer>(store, getDatasetPointerKey(channel));
    return pointer ? assertDatasetPointer(pointer) : null;
};

const writePointerAndHistory = async (
    store: ObjectStore,
    channel: DatasetChannel,
    action: DatasetHistoryRecord['action'],
    datasetVersion: string,
    manifestKey: string,
    notes?: string,
) => {
    const previous = await getCurrentPointer(store, channel);
    const publishedAt = new Date().toISOString();
    const pointer = assertDatasetPointer({
        datasetVersion,
        manifestKey,
        publishedAt,
        notes,
    });

    await store.putObject(getDatasetPointerKey(channel), JSON.stringify(pointer, null, 2), JSON_CONTENT_TYPE);
    const historyRecord: DatasetHistoryRecord = {
        ...pointer,
        action,
        channel,
        previousDatasetVersion: previous?.datasetVersion,
        recordedAt: publishedAt,
    };
    await store.putObject(
        getHistoryKey(channel, datasetVersion, formatDatasetTimestamp(new Date(publishedAt))),
        JSON.stringify(historyRecord, null, 2),
        JSON_CONTENT_TYPE,
    );

    return pointer;
};

export const promoteDataset = async (store: ObjectStore, options: PromoteDatasetOptions) => {
    const { manifestKey } = await readManifestByVersion(store, options.datasetVersion);
    return writePointerAndHistory(
        store,
        options.channel,
        'promote',
        options.datasetVersion,
        manifestKey,
        options.notes,
    );
};

export const rollbackDataset = async (store: ObjectStore, options: RollbackDatasetOptions) => {
    const { manifestKey } = await readManifestByVersion(store, options.datasetVersion);
    return writePointerAndHistory(
        store,
        options.channel,
        'rollback',
        options.datasetVersion,
        manifestKey,
        options.notes,
    );
};

const listHistoryRecords = async (store: ObjectStore, channel: DatasetChannel) => {
    const objects = await store.listObjects(`channels/history/${channel}/`);
    const records: DatasetHistoryRecord[] = [];

    for (const object of objects) {
        const parsed = await readJsonObject<DatasetHistoryRecord>(store, object.key);
        if (!parsed) {
            continue;
        }
        records.push(parsed);
    }

    return records.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
};

export const selectProtectedDatasetVersions = (params: {
    currentProd: DatasetPointer | null;
    currentPreview: DatasetPointer | null;
    prodHistory: DatasetHistoryRecord[];
    previewHistory: DatasetHistoryRecord[];
}) => {
    const protectedVersions = new Set<string>();

    if (params.currentProd) {
        protectedVersions.add(params.currentProd.datasetVersion);
    }
    if (params.currentPreview) {
        protectedVersions.add(params.currentPreview.datasetVersion);
    }

    for (const record of params.prodHistory.slice(0, 3)) {
        protectedVersions.add(record.datasetVersion);
    }
    for (const record of params.previewHistory.slice(0, 1)) {
        protectedVersions.add(record.datasetVersion);
    }

    return protectedVersions;
};

export const pruneDatasets = async (store: ObjectStore): Promise<PruneDatasetsResult> => {
    const [currentProd, currentPreview, prodHistory, previewHistory] = await Promise.all([
        getCurrentPointer(store, 'prod'),
        getCurrentPointer(store, 'preview'),
        listHistoryRecords(store, 'prod'),
        listHistoryRecords(store, 'preview'),
    ]);
    const protectedVersions = selectProtectedDatasetVersions({
        currentProd,
        currentPreview,
        prodHistory,
        previewHistory,
    });

    const previewCandidates = previewHistory.slice(1).map((record) => record.datasetVersion);
    const deletableVersions = [...new Set(previewCandidates)].filter((version) => !protectedVersions.has(version));
    const deletedDatasetVersions: string[] = [];

    for (const datasetVersion of deletableVersions) {
        const objects = await store.listObjects(`datasets/${datasetVersion}/`);
        await Promise.all(objects.map((object) => store.deleteObject(object.key)));
        deletedDatasetVersions.push(datasetVersion);
    }

    return {
        deletedDatasetVersions,
        protectedDatasetVersions: [...protectedVersions].sort(),
    };
};

const validateManifestArtifacts = async (store: ObjectStore, manifest: DatasetManifest) => {
    const descriptors = [
        manifest.runtimeArtifactSet.bootstrap.collections,
        manifest.runtimeArtifactSet.bootstrap.translators,
        manifest.runtimeArtifactSet.bootstrap.indexesFull,
        manifest.runtimeArtifactSet.integrity.chunks,
    ];

    for (const descriptor of descriptors) {
        const head = await store.headObject(descriptor.key);
        if (!head || head.bytes !== descriptor.bytes) {
            throw new Error(`Missing or invalid artifact: ${descriptor.key}`);
        }

        const remote = await store.getObject(descriptor.key);
        if (!remote || sha256Hex(remote.body) !== descriptor.sha256) {
            throw new Error(`Checksum validation failed for artifact: ${descriptor.key}`);
        }
    }

    const integrity = await readJsonObject<IntegrityArtifact>(store, manifest.runtimeArtifactSet.integrity.chunks.key);
    if (!integrity || !Array.isArray(integrity.entries)) {
        throw new Error('Invalid integrity artifact payload');
    }

    for (const entry of integrity.entries) {
        const head = await store.headObject(entry.key);
        if (!head || head.bytes !== entry.bytes) {
            throw new Error(`Missing or invalid chunk object: ${entry.key}`);
        }
    }

    return integrity;
};

export const validateRemoteDataset = async (
    store: ObjectStore,
    target: { datasetVersion?: string; channel?: DatasetChannel },
) => {
    if (!target.datasetVersion && !target.channel) {
        throw new Error('validateRemoteDataset requires a datasetVersion or channel');
    }

    let manifestKey: string;
    let manifest: DatasetManifest;
    let pointer: DatasetPointer | null = null;

    if (target.channel) {
        pointer = await getCurrentPointer(store, target.channel);
        if (!pointer) {
            throw new Error(`Missing pointer for channel ${target.channel}`);
        }
        manifestKey = pointer.manifestKey;
        const remoteManifest = await readJsonObject<DatasetManifest>(store, manifestKey);
        if (!remoteManifest) {
            throw new Error(`Missing manifest referenced by pointer: ${manifestKey}`);
        }
        manifest = assertDatasetManifest(remoteManifest);
    } else {
        const resolved = await readManifestByVersion(store, target.datasetVersion!);
        manifestKey = resolved.manifestKey;
        manifest = resolved.manifest;
    }

    const integrity = await validateManifestArtifacts(store, manifest);
    if (pointer) {
        assertDatasetPointer(pointer);
        if (pointer.manifestKey !== manifestKey) {
            throw new Error(`Pointer manifest key mismatch for ${target.channel}`);
        }
    }

    return {
        manifestKey,
        datasetVersion: manifest.datasetVersion,
        pointer,
        chunkCount: integrity.entries.length,
    };
};

export const validateLocalDataset = async (
    buildMetadataPath = DEFAULT_BUILD_METADATA_PATH,
    datasetVersion?: string,
) => {
    const prepared = await prepareDatasetPublish(buildMetadataPath, datasetVersion);

    for (const object of prepared.objects) {
        if (object.bytes === 0) {
            throw new Error(`Prepared object is empty: ${object.key}`);
        }
        if (sha256Hex(object.body) !== object.sha256) {
            throw new Error(`Checksum generation mismatch: ${object.key}`);
        }
    }

    assertDatasetManifest(prepared.manifest);

    return {
        datasetVersion: prepared.datasetVersion,
        manifestKey: prepared.manifestKey,
        objectCount: prepared.objects.length + 1,
    };
};

const streamToBytes = async (body: GetObjectCommandOutput['Body']) => {
    if (!body) {
        return null;
    }

    if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === 'function') {
        return new Uint8Array(
            await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray(),
        );
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
        chunks.push(typeof chunk === 'string' ? textEncoder.encode(chunk) : chunk);
    }

    if (chunks.length === 0) {
        return new Uint8Array();
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return combined;
};

export class S3CompatibleObjectStore implements ObjectStore {
    private readonly client: S3Client;

    constructor(
        private readonly bucketName: string,
        private readonly endpoint: string,
        accessKeyId: string,
        secretAccessKey: string,
        private readonly region = 'auto',
    ) {
        this.client = new S3Client({
            endpoint: this.endpoint,
            region: this.region,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
    }

    async putObject(key: string, body: ObjectPayload, contentType: string) {
        const upload = new Upload({
            client: this.client,
            params: {
                Bucket: this.bucketName,
                Key: key,
                Body: toBytes(body),
                ContentType: contentType,
            },
        });
        await upload.done();
    }

    async getObject(key: string) {
        try {
            const response = await this.client.send(
                new GetObjectCommand({
                    Bucket: this.bucketName,
                    Key: key,
                }),
            );
            const body = await streamToBytes(response.Body);
            if (!body) {
                return null;
            }
            return {
                key,
                bytes: Number(response.ContentLength ?? body.byteLength),
                body,
            };
        } catch (error) {
            if (error instanceof Error && /NoSuchKey|NotFound/i.test(error.name)) {
                return null;
            }
            throw error;
        }
    }

    async headObject(key: string) {
        try {
            const response = await this.client.send(
                new HeadObjectCommand({
                    Bucket: this.bucketName,
                    Key: key,
                }),
            );
            return {
                key,
                bytes: Number(response.ContentLength ?? 0),
            };
        } catch (error) {
            if (error instanceof Error && /NotFound|NoSuchKey/i.test(error.name)) {
                return null;
            }
            throw error;
        }
    }

    async listObjects(prefix: string) {
        const objects: ObjectHead[] = [];
        let continuationToken: string | undefined;

        do {
            const response = await this.client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucketName,
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                }),
            );
            for (const item of response.Contents ?? []) {
                if (!item.Key) {
                    continue;
                }
                objects.push({
                    key: item.Key,
                    bytes: Number(item.Size ?? 0),
                });
            }
            continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        } while (continuationToken);

        return objects.sort((left, right) => left.key.localeCompare(right.key));
    }

    async deleteObject(key: string) {
        await this.client.send(
            new DeleteObjectCommand({
                Bucket: this.bucketName,
                Key: key,
            }),
        );
    }
}

export class FileSystemObjectStore implements ObjectStore {
    constructor(private readonly rootDir: string) {}

    private resolve(key: string) {
        return join(this.rootDir, key);
    }

    async putObject(key: string, body: ObjectPayload, _contentType: string) {
        const filePath = this.resolve(key);
        await mkdir(dirname(filePath), { recursive: true });
        await Bun.write(filePath, toBytes(body));
    }

    async getObject(key: string) {
        const file = Bun.file(this.resolve(key));
        if (!(await file.exists())) {
            return null;
        }
        const body = new Uint8Array(await file.arrayBuffer());
        return {
            key,
            bytes: file.size,
            body,
        };
    }

    async headObject(key: string) {
        const file = Bun.file(this.resolve(key));
        if (!(await file.exists())) {
            return null;
        }
        return {
            key,
            bytes: file.size,
        };
    }

    async listObjects(prefix: string) {
        const basePath = this.resolve(prefix);
        const baseEntries = await readdir(basePath, { encoding: 'utf8', withFileTypes: true }).catch(() => null);
        if (!baseEntries) {
            const file = await this.headObject(prefix);
            return file ? [file] : [];
        }

        const objects: ObjectHead[] = [];
        const walk = async (dir: string) => {
            const entries =
                dir === basePath ? baseEntries : await readdir(dir, { encoding: 'utf8', withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walk(fullPath);
                    continue;
                }
                const key = relative(this.rootDir, fullPath).replace(/\\/g, '/');
                objects.push({
                    key,
                    bytes: Bun.file(fullPath).size,
                });
            }
        };

        await walk(basePath);
        return objects.sort((left, right) => left.key.localeCompare(right.key));
    }

    async deleteObject(key: string) {
        await rm(this.resolve(key), { force: true });
    }
}
