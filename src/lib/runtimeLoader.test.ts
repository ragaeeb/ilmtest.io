import { describe, expect, it } from 'bun:test';
import { ARTIFACT_SCHEMA_VERSION, CHUNK_SCHEMA_VERSION, DATASET_SCHEMA_VERSION, APP_MIN_DATASET_SCHEMA_VERSION } from './datasetManifest';
import { RuntimeCache } from './runtimeCache';
import { resolveDatasetManifest, resolveDatasetPointer } from './runtimeLoader';

describe('runtimeLoader', () => {
    it('resolves pointer + manifest with cache reuse', async () => {
        const pointer = {
            datasetVersion: '2026-03-12T18-42-10Z-abc1234',
            manifestKey: 'datasets/2026-03-12T18-42-10Z-abc1234/manifest.json',
            publishedAt: '2026-03-12T18:42:10.000Z',
        };
        const manifest = {
            datasetSchemaVersion: DATASET_SCHEMA_VERSION,
            chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
            artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
            appMinDatasetSchemaVersion: APP_MIN_DATASET_SCHEMA_VERSION,
            datasetVersion: pointer.datasetVersion,
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
            },
            artifactCounts: {
                chunks: 1,
                bootstrapArtifacts: 4,
                runtimeArtifacts: 1,
                integrityArtifacts: 1,
                totalObjects: 7,
            },
            artifactBytes: {
                chunks: 128,
                bootstrapArtifacts: 256,
                runtimeArtifacts: 256,
                integrityArtifacts: 64,
                total: 704,
            },
            runtimeArtifactSet: {
                bootstrap: {
                    collections: {
                        key: 'datasets/example/artifacts/bootstrap/collections.json',
                        bytes: 128,
                        sha256: 'abc123',
                        contentType: 'application/json',
                        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
                    },
                    translators: {
                        key: 'datasets/example/artifacts/bootstrap/translators.json',
                        bytes: 64,
                        sha256: 'abc124',
                        contentType: 'application/json',
                        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
                    },
                    routeBootstrap: {
                        key: 'datasets/example/artifacts/runtime/bootstrap/routes.json',
                        bytes: 64,
                        sha256: 'abc125',
                        contentType: 'application/json',
                        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
                    },
                    indexesFull: {
                        key: 'datasets/example/artifacts/bootstrap/indexes.full.json',
                        bytes: 128,
                        sha256: 'abc126',
                        contentType: 'application/json',
                        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
                    },
                },
                runtime: {
                    collectionShards: {
                        '1118': {
                            key: 'datasets/example/artifacts/runtime/collections/1118.json',
                            bytes: 64,
                            sha256: 'abc127',
                            contentType: 'application/json',
                            artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
                        },
                    },
                },
                integrity: {
                    chunks: {
                        key: 'datasets/example/artifacts/integrity/chunks.json',
                        bytes: 64,
                        sha256: 'abc128',
                        contentType: 'application/json',
                        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
                    },
                },
            },
        };

        const store = new Map<string, unknown>([
            ['channels/preview.json', pointer],
            [pointer.manifestKey, manifest],
        ]);

        let reads = 0;
        const readJson = async <T>(key: string) => {
            reads += 1;
            return store.get(key) as T;
        };

        const cache = new RuntimeCache(() => 0);
        const resolvedPointer = await resolveDatasetPointer('preview', readJson, cache);
        const resolvedManifest = await resolveDatasetManifest(resolvedPointer.manifestKey, readJson, cache);

        expect(resolvedPointer.datasetVersion).toBe(pointer.datasetVersion);
        expect(resolvedManifest.datasetVersion).toBe(pointer.datasetVersion);
        expect(reads).toBe(2);

        await resolveDatasetPointer('preview', readJson, cache);
        await resolveDatasetManifest(resolvedPointer.manifestKey, readJson, cache);
        expect(reads).toBe(2);
    });
});
