import { describe, expect, it } from 'bun:test';
import { ARTIFACT_SCHEMA_VERSION } from './datasetManifest';
import {
    assertCollectionRuntimeShard,
    assertRuntimeCollectionSummaryArray,
    assertRuntimeRouteBootstrap,
} from './runtimeArtifacts';

describe('runtimeArtifacts', () => {
    it('accepts valid route bootstrap and collection summaries', () => {
        const collections = assertRuntimeCollectionSummaryArray([
            {
                id: '1118',
                slug: 'sample',
                roman: 'Sample',
                unwan: 'عينة',
                authors: [],
                src: { id: '75', fid: '1118' },
                citationTemplate: 'https://example.com/:page',
                sectionCount: 2,
            },
        ]);

        const routeBootstrap = assertRuntimeRouteBootstrap({
            artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
            generatedAt: '2026-03-12T18:42:10.000Z',
            collectionsBySlug: {
                sample: { id: '1118' },
            },
        });

        expect(collections[0].id).toBe('1118');
        expect(routeBootstrap.collectionsBySlug.sample.id).toBe('1118');
    });

    it('accepts valid collection runtime shards', () => {
        const shard = assertCollectionRuntimeShard({
            artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
            generatedAt: '2026-03-12T18:42:10.000Z',
            collectionId: '1118',
            sectionOrder: ['S1'],
            sectionSummaries: {
                S1: {
                    sectionId: 'S1',
                    title: 'Section S1',
                    titleArabic: '',
                    excerptCount: 1,
                    firstPage: 1,
                },
            },
            sectionDescriptors: {
                S1: [{ chunkKey: '1118/S1/chunk-0.json', start: 1, end: 1 }],
            },
            sectionExcerpts: {
                S1: ['E1'],
            },
            excerptLookup: {
                E1: { sectionId: 'S1', chunkKey: '1118/S1/chunk-0.json', preview: 'Text' },
            },
        });

        expect(shard.collectionId).toBe('1118');
        expect(shard.sectionOrder).toEqual(['S1']);
    });

    it('rejects invalid shard payloads', () => {
        expect(() => assertCollectionRuntimeShard({})).toThrow();
    });
});
