import { afterAll, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    APP_MIN_DATASET_SCHEMA_VERSION,
    ARTIFACT_SCHEMA_VERSION,
    CHUNK_SCHEMA_VERSION,
    DATASET_SCHEMA_VERSION,
    type DatasetBuildMetadata,
} from '../src/lib/datasetManifest';
import {
    FileSystemObjectStore,
    generateDatasetVersion,
    prepareDatasetPublish,
    promoteDataset,
    pruneDatasets,
    publishDataset,
    rollbackDataset,
    selectProtectedDatasetVersions,
    validateLocalDataset,
    validateRemoteDataset,
} from './datasetControl';

const tempDirs: string[] = [];
const waitForTick = () => new Promise((resolve) => setTimeout(resolve, 5));

const createFixture = async () => {
    const root = await mkdtemp(join(tmpdir(), 'ilmtest-dataset-'));
    tempDirs.push(root);

    const dataDir = join(root, 'src-data');
    const chunksDir = join(root, 'chunks');
    const buildDir = join(root, 'build');
    const storeRoot = join(root, 'store');
    const stateDir = join(root, 'state');

    await Promise.all([
        mkdir(dataDir, { recursive: true }),
        mkdir(join(chunksDir, '1118', 'S1'), { recursive: true }),
        mkdir(join(chunksDir, '1118', 'S2'), { recursive: true }),
        mkdir(buildDir, { recursive: true }),
        mkdir(storeRoot, { recursive: true }),
        mkdir(stateDir, { recursive: true }),
    ]);

    await Promise.all([Bun.write(join(dataDir, '.keep'), ''), Bun.write(join(chunksDir, '.keep'), '')]);
    await rm(join(dataDir, '.keep'));
    await rm(join(chunksDir, '.keep'));

    await Bun.write(
        join(dataDir, 'collections.json'),
        JSON.stringify(
            [
                {
                    id: '1118',
                    slug: 'sample',
                    roman: 'Sample',
                    unwan: 'عينة',
                    authors: [],
                    src: { id: '75', fid: '1118' },
                    citationTemplate: 'https://example.com/:page',
                },
            ],
            null,
            2,
        ),
    );
    await Bun.write(join(dataDir, 'translators.json'), JSON.stringify([{ id: 1, name: 'Translator' }], null, 2));
    await Bun.write(
        join(dataDir, 'indexes.json'),
        JSON.stringify(
            {
                sectionToExcerpts: { '1118': { S1: ['E1'], S2: ['E2'] } },
                excerptToSection: { '1118': { E1: 'S1', E2: 'S2' } },
                pageToHeading: { '1118': { 1: 'S1', 2: 'S2' } },
                collectionToSections: { '1118': ['S1', 'S2'] },
                sectionToChunks: { '1118': { S1: ['1118/S1/chunk-0.json'], S2: ['1118/S2/chunk-0.json'] } },
                excerptToChunk: { '1118': { E1: '1118/S1/chunk-0.json', E2: '1118/S2/chunk-0.json' } },
                entityToCollections: {},
            },
            null,
            2,
        ),
    );

    await Bun.write(
        join(chunksDir, '1118', 'S1', 'chunk-0.json'),
        JSON.stringify({
            sectionId: 'S1',
            excerptIds: ['E1'],
            excerpts: [{ id: 'E1', from: 1, nass: 'نص', text: 'Text', translator: 1, lastUpdatedAt: 0 }],
        }),
    );
    await Bun.write(
        join(chunksDir, '1118', 'S2', 'chunk-0.json'),
        JSON.stringify({
            sectionId: 'S2',
            excerptIds: ['E2'],
            excerpts: [{ id: 'E2', from: 2, nass: 'نص', text: 'Text', translator: 1, lastUpdatedAt: 0 }],
        }),
    );

    const buildMetadataPath = join(buildDir, 'metadata.json');
    const metadata: DatasetBuildMetadata = {
        generatedAt: '2026-03-12T18:42:10.000Z',
        gitCommit: 'abc1234',
        schemaVersions: {
            datasetSchemaVersion: DATASET_SCHEMA_VERSION,
            chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
            artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
            appMinDatasetSchemaVersion: APP_MIN_DATASET_SCHEMA_VERSION,
        },
        sourceProvenance: [
            { name: 'excerptStore', dataset: 'org/excerpts', revision: 'main' },
            { name: 'aslStore', dataset: 'org/asl', revision: 'main' },
            { name: 'shamelaStore', dataset: 'org/shamela', revision: 'main' },
        ],
        toolVersions: {
            app: '0.0.2',
            sdk: '^5.0.0',
            bun: Bun.version,
            node: process.versions.node,
            wrangler: '^4.72.0',
        },
        counts: {
            collections: 1,
            translators: 1,
            sections: 2,
            excerpts: 2,
            chunks: 2,
        },
        bytes: {
            chunkBytes: 0,
            srcDataBytes: 0,
        },
        outputs: {
            collectionsFile: join(dataDir, 'collections.json'),
            translatorsFile: join(dataDir, 'translators.json'),
            indexesFile: join(dataDir, 'indexes.json'),
            chunksDir,
        },
    };
    await Bun.write(buildMetadataPath, JSON.stringify(metadata, null, 2));

    return {
        buildMetadataPath,
        stateDir,
        store: new FileSystemObjectStore(storeRoot),
    };
};

afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('datasetControl', () => {
    it('generates timestamped dataset versions', () => {
        const value = generateDatasetVersion('abc1234', new Date('2026-03-12T18:42:10Z'));
        expect(value).toBe('2026-03-12T18-42-10Z-abc1234');
    });

    it('prepares and validates a local dataset publish payload', async () => {
        const fixture = await createFixture();
        const prepared = await prepareDatasetPublish(fixture.buildMetadataPath, '2026-03-12T18-42-10Z-abc1234');

        expect(prepared.datasetVersion).toBe('2026-03-12T18-42-10Z-abc1234');
        expect(prepared.manifest.runtimeArtifactSet.bootstrap.collections.key).toContain('/collections.json');
        expect(prepared.objects.some((object) => object.key.endsWith('/artifacts/integrity/chunks.json'))).toBe(true);

        const localValidation = await validateLocalDataset(fixture.buildMetadataPath, '2026-03-12T18-42-10Z-abc1234');
        expect(localValidation.objectCount).toBeGreaterThan(1);
    });

    it('resumes an interrupted publish and validates the remote dataset', async () => {
        const fixture = await createFixture();
        const datasetVersion = '2026-03-12T18-42-10Z-abc1234';

        const failingPublish = publishDataset(fixture.store, {
            buildMetadataPath: fixture.buildMetadataPath,
            datasetVersion,
            stateDir: fixture.stateDir,
            simulateFailureAfter: 2,
        });
        let thrownMessage = '';
        try {
            await failingPublish;
        } catch (error) {
            thrownMessage = error instanceof Error ? error.message : String(error);
        }
        expect(thrownMessage).toContain('Simulated publish failure');

        const state = JSON.parse(await Bun.file(join(fixture.stateDir, `${datasetVersion}.json`)).text());
        expect(state.uploadedKeys.length).toBeGreaterThan(0);

        await publishDataset(fixture.store, {
            buildMetadataPath: fixture.buildMetadataPath,
            datasetVersion,
            stateDir: fixture.stateDir,
        });

        const remoteValidation = await validateRemoteDataset(fixture.store, { datasetVersion });
        expect(remoteValidation.chunkCount).toBe(2);
    });

    it('promotes, rolls back, and prunes preview datasets', async () => {
        const fixture = await createFixture();
        const firstVersion = '2026-03-12T18-42-10Z-abc1234';
        const secondVersion = '2026-03-12T19-42-10Z-def5678';

        await publishDataset(fixture.store, {
            buildMetadataPath: fixture.buildMetadataPath,
            datasetVersion: firstVersion,
            stateDir: fixture.stateDir,
        });
        await promoteDataset(fixture.store, { channel: 'preview', datasetVersion: firstVersion });
        await waitForTick();

        await publishDataset(fixture.store, {
            buildMetadataPath: fixture.buildMetadataPath,
            datasetVersion: secondVersion,
            stateDir: fixture.stateDir,
        });
        await promoteDataset(fixture.store, { channel: 'preview', datasetVersion: secondVersion });
        await waitForTick();

        const previewBeforeRollback = await validateRemoteDataset(fixture.store, { channel: 'preview' });
        expect(previewBeforeRollback.datasetVersion).toBe(secondVersion);

        await rollbackDataset(fixture.store, { channel: 'preview', datasetVersion: firstVersion });
        await waitForTick();
        const previewAfterRollback = await validateRemoteDataset(fixture.store, { channel: 'preview' });
        expect(previewAfterRollback.datasetVersion).toBe(firstVersion);

        await promoteDataset(fixture.store, { channel: 'preview', datasetVersion: secondVersion });
        await waitForTick();
        const pruned = await pruneDatasets(fixture.store);
        expect(pruned.deletedDatasetVersions).toContain(firstVersion);
    });

    it('selects retained dataset versions for prod and preview channels', () => {
        const protectedVersions = selectProtectedDatasetVersions({
            currentProd: {
                datasetVersion: 'prod-current',
                manifestKey: 'datasets/prod-current/manifest.json',
                publishedAt: '2026-03-12T18:42:10.000Z',
            },
            currentPreview: {
                datasetVersion: 'preview-current',
                manifestKey: 'datasets/preview-current/manifest.json',
                publishedAt: '2026-03-12T19:42:10.000Z',
            },
            prodHistory: [
                {
                    action: 'promote',
                    channel: 'prod',
                    datasetVersion: 'prod-current',
                    manifestKey: 'datasets/prod-current/manifest.json',
                    publishedAt: '2026-03-12T18:42:10.000Z',
                    recordedAt: '2026-03-12T18:42:10.000Z',
                },
                {
                    action: 'promote',
                    channel: 'prod',
                    datasetVersion: 'prod-old-1',
                    manifestKey: 'datasets/prod-old-1/manifest.json',
                    publishedAt: '2026-03-11T18:42:10.000Z',
                    recordedAt: '2026-03-11T18:42:10.000Z',
                },
                {
                    action: 'promote',
                    channel: 'prod',
                    datasetVersion: 'prod-old-2',
                    manifestKey: 'datasets/prod-old-2/manifest.json',
                    publishedAt: '2026-03-10T18:42:10.000Z',
                    recordedAt: '2026-03-10T18:42:10.000Z',
                },
            ],
            previewHistory: [
                {
                    action: 'promote',
                    channel: 'preview',
                    datasetVersion: 'preview-current',
                    manifestKey: 'datasets/preview-current/manifest.json',
                    publishedAt: '2026-03-12T19:42:10.000Z',
                    recordedAt: '2026-03-12T19:42:10.000Z',
                },
                {
                    action: 'promote',
                    channel: 'preview',
                    datasetVersion: 'preview-old',
                    manifestKey: 'datasets/preview-old/manifest.json',
                    publishedAt: '2026-03-11T19:42:10.000Z',
                    recordedAt: '2026-03-11T19:42:10.000Z',
                },
            ],
        });

        expect(protectedVersions.has('prod-current')).toBe(true);
        expect(protectedVersions.has('preview-current')).toBe(true);
        expect(protectedVersions.has('prod-old-1')).toBe(true);
        expect(protectedVersions.has('preview-old')).toBe(false);
    });
});
