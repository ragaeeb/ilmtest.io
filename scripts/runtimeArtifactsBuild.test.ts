import { describe, expect, it } from 'bun:test';
import type { Collection, Excerpt } from '@/types/excerpts';
import { buildRuntimeArtifacts } from './runtimeArtifactsBuild';

const makeCollection = (overrides: Partial<Collection> = {}): Collection => ({
    id: '2575',
    slug: 'sample-book',
    roman: 'Sample Book',
    unwan: 'كتاب تجريبي',
    citationTemplate: 'https://example.com/:page',
    src: { id: '75', fid: '2575' },
    authors: [],
    ...overrides,
});

const makeHeadingMarker = (overrides: Partial<Excerpt> = {}): Excerpt => ({
    id: 'T1',
    from: 1,
    nass: 'مقدمة الناشر',
    text: "Publisher's introduction",
    translator: 879,
    lastUpdatedAt: 1764039718,
    ...overrides,
});

describe('buildRuntimeArtifacts', () => {
    it('keeps empty sections in runtime artifacts without chunk descriptors', async () => {
        const artifacts = await buildRuntimeArtifacts({
            collections: [makeCollection()],
            indexes: {
                sectionToExcerpts: { '2575': { T1: [] } },
                excerptToSection: { '2575': { T1: 'T1' } },
                pageToHeading: { '2575': { 1: 'T1' } },
                collectionToSections: { '2575': ['T1'] },
                sectionToChunks: { '2575': { T1: [] } },
                excerptToChunk: { '2575': {} },
                entityToCollections: {},
            },
            chunksDir: '.',
            generatedAt: '2026-03-13T12:00:00.000Z',
            headingMarkersByCollection: {
                '2575': new Map([['T1', makeHeadingMarker()]]),
            },
        });

        const shard = artifacts.collectionShards['2575'];
        expect(shard.sectionOrder).toEqual(['T1']);
        expect(shard.sectionSummaries.T1).toEqual({
            sectionId: 'T1',
            title: "Publisher's introduction",
            titleArabic: 'مقدمة الناشر',
            excerptCount: 0,
            firstPage: 1,
        });
        expect(shard.sectionDescriptors.T1).toEqual([]);
        expect(shard.sectionExcerpts.T1).toEqual([]);
    });

    it('still fails when a section has excerpts but no chunk descriptors', async () => {
        return expect(
            buildRuntimeArtifacts({
                collections: [makeCollection()],
                indexes: {
                    sectionToExcerpts: { '2575': { T1: ['C1'] } },
                    excerptToSection: { '2575': { T1: 'T1', C1: 'T1' } },
                    pageToHeading: { '2575': { 1: 'T1' } },
                    collectionToSections: { '2575': ['T1'] },
                    sectionToChunks: { '2575': { T1: [] } },
                    excerptToChunk: { '2575': {} },
                    entityToCollections: {},
                },
                chunksDir: '.',
                generatedAt: '2026-03-13T12:00:00.000Z',
                headingMarkersByCollection: {
                    '2575': new Map([['T1', makeHeadingMarker()]]),
                },
            }),
        ).rejects.toThrow('Missing chunk descriptors for section 2575/T1');
    });
});
