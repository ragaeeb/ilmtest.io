import { describe, expect, it } from 'bun:test';
import {
    APP_MIN_DATASET_SCHEMA_VERSION,
    ARTIFACT_SCHEMA_VERSION,
    assertDatasetBuildMetadata,
    assertDatasetManifest,
    CHUNK_SCHEMA_VERSION,
    DATASET_SCHEMA_VERSION,
    type DatasetBuildMetadata,
    type DatasetManifest,
    isDatasetArtifactDescriptor,
    isDatasetBuildMetadata,
    isDatasetManifest,
} from './datasetManifest';

const descriptor = {
    key: 'datasets/example/artifacts/bootstrap/collections.json',
    bytes: 128,
    sha256: 'abc123',
    contentType: 'application/json',
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
};

describe('datasetManifest', () => {
    it('accepts a valid dataset manifest', () => {
        const manifest: DatasetManifest = {
            datasetSchemaVersion: DATASET_SCHEMA_VERSION,
            chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
            artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
            appMinDatasetSchemaVersion: APP_MIN_DATASET_SCHEMA_VERSION,
            datasetVersion: '2026-03-12T18-42-10Z-abc1234',
            createdAt: '2026-03-12T18:42:10.000Z',
            gitCommit: 'abc1234',
            sourceProvenance: [
                { name: 'excerptStore', dataset: 'org/excerpts', revision: 'main' },
                { name: 'aslStore', dataset: 'org/asl', revision: 'main' },
                { name: 'shamelaStore', dataset: 'org/shamela', revision: 'main' },
            ],
            toolVersions: {
                app: '0.0.2',
                sdk: '^5.0.0',
                bun: '1.3.10',
                node: '25.0.0',
                wrangler: '^4.72.0',
            },
            artifactCounts: {
                chunks: 2,
                bootstrapArtifacts: 3,
                integrityArtifacts: 1,
                totalObjects: 6,
            },
            artifactBytes: {
                chunks: 256,
                bootstrapArtifacts: 384,
                integrityArtifacts: 64,
                total: 704,
            },
            runtimeArtifactSet: {
                bootstrap: {
                    collections: descriptor,
                    translators: { ...descriptor, key: 'datasets/example/artifacts/bootstrap/translators.json' },
                    indexesFull: { ...descriptor, key: 'datasets/example/artifacts/bootstrap/indexes.full.json' },
                },
                integrity: {
                    chunks: { ...descriptor, key: 'datasets/example/artifacts/integrity/chunks.json' },
                },
            },
        };

        expect(isDatasetArtifactDescriptor(descriptor)).toBe(true);
        expect(isDatasetManifest(manifest)).toBe(true);
        expect(assertDatasetManifest(manifest)).toEqual(manifest);
    });

    it('accepts valid build metadata', () => {
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
                bun: '1.3.10',
                node: '25.0.0',
                wrangler: '^4.72.0',
            },
            counts: {
                collections: 1,
                translators: 1,
                sections: 1,
                excerpts: 2,
                chunks: 2,
            },
            bytes: {
                chunkBytes: 256,
                srcDataBytes: 384,
            },
            outputs: {
                collectionsFile: 'src/data/collections.json',
                translatorsFile: 'src/data/translators.json',
                indexesFile: 'src/data/indexes.json',
                chunksDir: 'tmp/excerpt-chunks',
            },
        };

        expect(isDatasetBuildMetadata(metadata)).toBe(true);
        expect(assertDatasetBuildMetadata(metadata)).toEqual(metadata);
    });

    it('rejects malformed manifests', () => {
        expect(
            isDatasetManifest({
                datasetVersion: 'v1',
            }),
        ).toBe(false);
    });
});
