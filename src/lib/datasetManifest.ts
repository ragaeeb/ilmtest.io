export const DATASET_SCHEMA_VERSION = 1;
export const CHUNK_SCHEMA_VERSION = 1;
export const ARTIFACT_SCHEMA_VERSION = 1;
export const APP_MIN_DATASET_SCHEMA_VERSION = 1;

export type DatasetSchemaVersions = {
    datasetSchemaVersion: number;
    chunkSchemaVersion: number;
    artifactSchemaVersion: number;
    appMinDatasetSchemaVersion: number;
};

export type DatasetSourceProvenance = {
    name: 'excerptStore' | 'aslStore' | 'shamelaStore';
    dataset: string;
    revision: string;
};

export type DatasetToolVersions = {
    app: string;
    sdk: string;
    bun: string;
    node: string;
    wrangler?: string;
};

export type DatasetArtifactDescriptor = {
    key: string;
    bytes: number;
    sha256: string;
    contentType: string;
    artifactSchemaVersion: number;
};

export type RuntimeArtifactSet = {
    bootstrap: {
        collections: DatasetArtifactDescriptor;
        translators: DatasetArtifactDescriptor;
        indexesFull: DatasetArtifactDescriptor;
    };
    integrity: {
        chunks: DatasetArtifactDescriptor;
    };
};

export type DatasetManifest = DatasetSchemaVersions & {
    datasetVersion: string;
    createdAt: string;
    gitCommit: string;
    sourceProvenance: DatasetSourceProvenance[];
    toolVersions: DatasetToolVersions;
    artifactCounts: {
        chunks: number;
        bootstrapArtifacts: number;
        integrityArtifacts: number;
        totalObjects: number;
    };
    artifactBytes: {
        chunks: number;
        bootstrapArtifacts: number;
        integrityArtifacts: number;
        total: number;
    };
    runtimeArtifactSet: RuntimeArtifactSet;
};

export type DatasetBuildMetadata = {
    generatedAt: string;
    gitCommit: string;
    schemaVersions: DatasetSchemaVersions;
    sourceProvenance: DatasetSourceProvenance[];
    toolVersions: DatasetToolVersions;
    counts: {
        collections: number;
        translators: number;
        sections: number;
        excerpts: number;
        chunks: number;
    };
    bytes: {
        chunkBytes: number;
        srcDataBytes: number;
    };
    outputs: {
        collectionsFile: string;
        translatorsFile: string;
        indexesFile: string;
        chunksDir: string;
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isIsoDateString = (value: unknown): value is string =>
    isNonEmptyString(value) && !Number.isNaN(Date.parse(value));

const isSchemaVersions = (value: unknown): value is DatasetSchemaVersions => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isFiniteNumber(value.datasetSchemaVersion) &&
        isFiniteNumber(value.chunkSchemaVersion) &&
        isFiniteNumber(value.artifactSchemaVersion) &&
        isFiniteNumber(value.appMinDatasetSchemaVersion)
    );
};

const isSourceProvenance = (value: unknown): value is DatasetSourceProvenance => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        (value.name === 'excerptStore' || value.name === 'aslStore' || value.name === 'shamelaStore') &&
        isNonEmptyString(value.dataset) &&
        isNonEmptyString(value.revision)
    );
};

const isToolVersions = (value: unknown): value is DatasetToolVersions => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isNonEmptyString(value.app) &&
        isNonEmptyString(value.sdk) &&
        isNonEmptyString(value.bun) &&
        isNonEmptyString(value.node) &&
        (!('wrangler' in value) || value.wrangler === undefined || isNonEmptyString(value.wrangler))
    );
};

export const isDatasetArtifactDescriptor = (value: unknown): value is DatasetArtifactDescriptor => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isNonEmptyString(value.key) &&
        isFiniteNumber(value.bytes) &&
        isNonEmptyString(value.sha256) &&
        isNonEmptyString(value.contentType) &&
        isFiniteNumber(value.artifactSchemaVersion)
    );
};

const isRuntimeArtifactSet = (value: unknown): value is RuntimeArtifactSet => {
    if (!isRecord(value) || !isRecord(value.bootstrap) || !isRecord(value.integrity)) {
        return false;
    }

    return (
        isDatasetArtifactDescriptor(value.bootstrap.collections) &&
        isDatasetArtifactDescriptor(value.bootstrap.translators) &&
        isDatasetArtifactDescriptor(value.bootstrap.indexesFull) &&
        isDatasetArtifactDescriptor(value.integrity.chunks)
    );
};

export const isDatasetManifest = (value: unknown): value is DatasetManifest => {
    if (!isRecord(value) || !isSchemaVersions(value)) {
        return false;
    }

    const candidate = value as Record<string, unknown> & DatasetSchemaVersions;

    if (
        !isNonEmptyString(candidate.datasetVersion) ||
        !isIsoDateString(candidate.createdAt) ||
        !isNonEmptyString(candidate.gitCommit)
    ) {
        return false;
    }

    if (
        !Array.isArray(candidate.sourceProvenance) ||
        candidate.sourceProvenance.some((entry: unknown) => !isSourceProvenance(entry))
    ) {
        return false;
    }

    if (!isToolVersions(candidate.toolVersions) || !isRuntimeArtifactSet(candidate.runtimeArtifactSet)) {
        return false;
    }

    if (!isRecord(candidate.artifactCounts) || !isRecord(candidate.artifactBytes)) {
        return false;
    }

    return (
        isFiniteNumber(candidate.artifactCounts.chunks) &&
        isFiniteNumber(candidate.artifactCounts.bootstrapArtifacts) &&
        isFiniteNumber(candidate.artifactCounts.integrityArtifacts) &&
        isFiniteNumber(candidate.artifactCounts.totalObjects) &&
        isFiniteNumber(candidate.artifactBytes.chunks) &&
        isFiniteNumber(candidate.artifactBytes.bootstrapArtifacts) &&
        isFiniteNumber(candidate.artifactBytes.integrityArtifacts) &&
        isFiniteNumber(candidate.artifactBytes.total)
    );
};

export const isDatasetBuildMetadata = (value: unknown): value is DatasetBuildMetadata => {
    if (!isRecord(value) || !isIsoDateString(value.generatedAt) || !isNonEmptyString(value.gitCommit)) {
        return false;
    }

    if (
        !isSchemaVersions(value.schemaVersions) ||
        !Array.isArray(value.sourceProvenance) ||
        value.sourceProvenance.some((entry) => !isSourceProvenance(entry)) ||
        !isToolVersions(value.toolVersions)
    ) {
        return false;
    }

    if (!isRecord(value.counts) || !isRecord(value.bytes) || !isRecord(value.outputs)) {
        return false;
    }

    return (
        isFiniteNumber(value.counts.collections) &&
        isFiniteNumber(value.counts.translators) &&
        isFiniteNumber(value.counts.sections) &&
        isFiniteNumber(value.counts.excerpts) &&
        isFiniteNumber(value.counts.chunks) &&
        isFiniteNumber(value.bytes.chunkBytes) &&
        isFiniteNumber(value.bytes.srcDataBytes) &&
        isNonEmptyString(value.outputs.collectionsFile) &&
        isNonEmptyString(value.outputs.translatorsFile) &&
        isNonEmptyString(value.outputs.indexesFile) &&
        isNonEmptyString(value.outputs.chunksDir)
    );
};

export const assertDatasetManifest = (value: unknown): DatasetManifest => {
    if (!isDatasetManifest(value)) {
        throw new Error('Invalid dataset manifest payload');
    }

    return value;
};

export const assertDatasetBuildMetadata = (value: unknown): DatasetBuildMetadata => {
    if (!isDatasetBuildMetadata(value)) {
        throw new Error('Invalid dataset build metadata payload');
    }

    return value;
};
