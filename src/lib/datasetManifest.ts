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

export type DatasetArtifactDescriptorMap = Record<string, DatasetArtifactDescriptor>;

export type RuntimeArtifactSet = {
    bootstrap: {
        collections: DatasetArtifactDescriptor;
        translators: DatasetArtifactDescriptor;
        routeBootstrap: DatasetArtifactDescriptor;
        indexesFull: DatasetArtifactDescriptor;
    };
    runtime: {
        collectionShards: DatasetArtifactDescriptorMap;
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
        runtimeArtifacts: number;
        integrityArtifacts: number;
        totalObjects: number;
    };
    artifactBytes: {
        chunks: number;
        bootstrapArtifacts: number;
        runtimeArtifacts: number;
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
        routeBootstrapFile: string;
        runtimeArtifactsDir: string;
    };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => isRecord(value) && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const ISO_UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const isIsoDateString = (value: unknown): value is string =>
    isNonEmptyString(value) && ISO_UTC_DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

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

const describeArtifactDescriptor = (value: unknown, path: string) => {
    return isDatasetArtifactDescriptor(value) ? null : `${path} must be a valid dataset artifact descriptor`;
};

const describeSchemaVersions = (value: unknown, path: string) => {
    if (!isPlainRecord(value)) {
        return `${path} must be an object`;
    }
    if (!isFiniteNumber(value.datasetSchemaVersion)) {
        return `${path}.datasetSchemaVersion must be a finite number`;
    }
    if (!isFiniteNumber(value.chunkSchemaVersion)) {
        return `${path}.chunkSchemaVersion must be a finite number`;
    }
    if (!isFiniteNumber(value.artifactSchemaVersion)) {
        return `${path}.artifactSchemaVersion must be a finite number`;
    }
    if (!isFiniteNumber(value.appMinDatasetSchemaVersion)) {
        return `${path}.appMinDatasetSchemaVersion must be a finite number`;
    }
    return null;
};

const describeSourceProvenanceList = (value: unknown, path: string) => {
    if (!Array.isArray(value)) {
        return `${path} must be an array`;
    }

    for (const [index, entry] of value.entries()) {
        if (isSourceProvenance(entry)) {
            continue;
        }
        return `${path}[${index}] must be a valid source provenance entry`;
    }

    return null;
};

const describeToolVersions = (value: unknown, path: string) => {
    if (isToolVersions(value)) {
        return null;
    }

    return `${path} must be a valid tool versions object`;
};

const describeCollectionShardMap = (value: unknown, path: string) => {
    if (!isPlainRecord(value)) {
        return `${path} must be an object map`;
    }

    for (const [collectionId, descriptor] of Object.entries(value)) {
        const error = describeArtifactDescriptor(descriptor, `${path}.${collectionId}`);
        if (error) {
            return error;
        }
    }

    return null;
};

const describeRuntimeArtifactSet = (value: unknown, path: string) => {
    if (
        !isPlainRecord(value) ||
        !isPlainRecord(value.bootstrap) ||
        !isPlainRecord(value.runtime) ||
        !isPlainRecord(value.integrity)
    ) {
        return `${path} must contain bootstrap, runtime, and integrity objects`;
    }

    return (
        describeArtifactDescriptor(value.bootstrap.collections, `${path}.bootstrap.collections`) ??
        describeArtifactDescriptor(value.bootstrap.translators, `${path}.bootstrap.translators`) ??
        describeArtifactDescriptor(value.bootstrap.routeBootstrap, `${path}.bootstrap.routeBootstrap`) ??
        describeArtifactDescriptor(value.bootstrap.indexesFull, `${path}.bootstrap.indexesFull`) ??
        describeCollectionShardMap(value.runtime.collectionShards, `${path}.runtime.collectionShards`) ??
        describeArtifactDescriptor(value.integrity.chunks, `${path}.integrity.chunks`)
    );
};

const describeNumericRecord = (value: unknown, path: string, fields: string[]) => {
    if (!isPlainRecord(value)) {
        return `${path} must be an object`;
    }

    for (const field of fields) {
        if (!isFiniteNumber(value[field])) {
            return `${path}.${field} must be a finite number`;
        }
    }

    return null;
};

const describeStringRecord = (value: unknown, path: string, fields: string[]) => {
    if (!isPlainRecord(value)) {
        return `${path} must be an object`;
    }

    for (const field of fields) {
        if (!isNonEmptyString(value[field])) {
            return `${path}.${field} must be a non-empty string`;
        }
    }

    return null;
};

const describeDatasetManifest = (value: unknown) => {
    if (!isPlainRecord(value)) {
        return 'manifest must be an object';
    }

    const schemaError = describeSchemaVersions(value, 'manifest');
    if (schemaError) {
        return schemaError;
    }

    const candidate = value as Record<string, unknown> & DatasetSchemaVersions;
    if (!isNonEmptyString(candidate.datasetVersion)) {
        return 'manifest.datasetVersion must be a non-empty string';
    }
    if (!isIsoDateString(candidate.createdAt)) {
        return 'manifest.createdAt must be a strict UTC ISO-8601 string';
    }
    if (!isNonEmptyString(candidate.gitCommit)) {
        return 'manifest.gitCommit must be a non-empty string';
    }

    return (
        describeSourceProvenanceList(candidate.sourceProvenance, 'manifest.sourceProvenance') ??
        describeToolVersions(candidate.toolVersions, 'manifest.toolVersions') ??
        describeRuntimeArtifactSet(candidate.runtimeArtifactSet, 'manifest.runtimeArtifactSet') ??
        describeNumericRecord(candidate.artifactCounts, 'manifest.artifactCounts', [
            'chunks',
            'bootstrapArtifacts',
            'runtimeArtifacts',
            'integrityArtifacts',
            'totalObjects',
        ]) ??
        describeNumericRecord(candidate.artifactBytes, 'manifest.artifactBytes', [
            'chunks',
            'bootstrapArtifacts',
            'runtimeArtifacts',
            'integrityArtifacts',
            'total',
        ])
    );
};

export const isDatasetManifest = (value: unknown): value is DatasetManifest => {
    return describeDatasetManifest(value) === null;
};

const describeDatasetBuildMetadata = (value: unknown) => {
    if (!isPlainRecord(value)) {
        return 'build metadata must be an object';
    }
    if (!isIsoDateString(value.generatedAt)) {
        return 'build metadata.generatedAt must be a strict UTC ISO-8601 string';
    }
    if (!isNonEmptyString(value.gitCommit)) {
        return 'build metadata.gitCommit must be a non-empty string';
    }

    return (
        describeSchemaVersions(value.schemaVersions, 'build metadata.schemaVersions') ??
        describeSourceProvenanceList(value.sourceProvenance, 'build metadata.sourceProvenance') ??
        describeToolVersions(value.toolVersions, 'build metadata.toolVersions') ??
        describeNumericRecord(value.counts, 'build metadata.counts', [
            'collections',
            'translators',
            'sections',
            'excerpts',
            'chunks',
        ]) ??
        describeNumericRecord(value.bytes, 'build metadata.bytes', ['chunkBytes', 'srcDataBytes']) ??
        describeStringRecord(value.outputs, 'build metadata.outputs', [
            'collectionsFile',
            'translatorsFile',
            'indexesFile',
            'chunksDir',
            'routeBootstrapFile',
            'runtimeArtifactsDir',
        ])
    );
};

export const isDatasetBuildMetadata = (value: unknown): value is DatasetBuildMetadata => {
    return describeDatasetBuildMetadata(value) === null;
};

export const assertDatasetManifest = (value: unknown): DatasetManifest => {
    const error = describeDatasetManifest(value);
    if (error) {
        throw new Error(`Invalid dataset manifest payload: ${error}`);
    }

    return value as DatasetManifest;
};

export const assertDatasetBuildMetadata = (value: unknown): DatasetBuildMetadata => {
    const error = describeDatasetBuildMetadata(value);
    if (error) {
        throw new Error(`Invalid dataset build metadata payload: ${error}`);
    }

    return value as DatasetBuildMetadata;
};
