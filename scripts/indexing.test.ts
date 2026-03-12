import { describe, expect, it } from 'bun:test';
import type { Compilation, Excerpt, Heading } from '../src/types/excerpts';
import {
    addEntityMappings,
    findSectionForExcerpt,
    generateIndexes,
    type LookupIndexes,
    mergeIndexes,
} from './indexing';

describe('findSectionForExcerpt', () => {
    const headings: Heading[] = [
        { id: 'H1', from: 1, nass: 'مقدمة', text: 'Introduction', translator: 890, lastUpdatedAt: 0 },
        { id: 'H2', from: 10, nass: 'باب الأول', text: 'Chapter 1', translator: 890, lastUpdatedAt: 0 },
        { id: 'H3', from: 50, nass: 'باب الثاني', text: 'Chapter 2', translator: 890, lastUpdatedAt: 0 },
    ];

    it('should return null for empty headings', () => {
        const excerpt: Excerpt = { id: 'P1', from: 5, nass: 'test', text: 'test', translator: 890, lastUpdatedAt: 0 };
        expect(findSectionForExcerpt(excerpt, [])).toBeNull();
    });

    it('should find section for excerpt at exact heading page', () => {
        const excerpt: Excerpt = { id: 'P1', from: 1, nass: 'test', text: 'test', translator: 890, lastUpdatedAt: 0 };
        expect(findSectionForExcerpt(excerpt, headings)).toBe('H1');
    });

    it('should find section for excerpt between headings', () => {
        const excerpt: Excerpt = { id: 'P1', from: 25, nass: 'test', text: 'test', translator: 890, lastUpdatedAt: 0 };
        expect(findSectionForExcerpt(excerpt, headings)).toBe('H2');
    });

    it('should find section for excerpt after last heading', () => {
        const excerpt: Excerpt = { id: 'P1', from: 100, nass: 'test', text: 'test', translator: 890, lastUpdatedAt: 0 };
        expect(findSectionForExcerpt(excerpt, headings)).toBe('H3');
    });

    it('should handle unsorted headings', () => {
        const unsortedHeadings: Heading[] = [
            { id: 'H3', from: 50, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
            { id: 'H1', from: 1, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
            { id: 'H2', from: 10, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
        ];
        const excerpt: Excerpt = { id: 'P1', from: 25, nass: 'test', text: 'test', translator: 890, lastUpdatedAt: 0 };
        expect(findSectionForExcerpt(excerpt, unsortedHeadings)).toBe('H2');
    });
});

describe('generateIndexes', () => {
    it('should generate correct indexes for collection', () => {
        const headings: Heading[] = [
            { id: 'H1', from: 1, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
            { id: 'H2', from: 10, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
        ];
        const excerpts: Excerpt[] = [
            { id: 'P1', from: 1, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
            { id: 'P2', from: 5, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
            { id: 'P3', from: 10, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
            { id: 'P4', from: 15, nass: '', text: '', translator: 890, lastUpdatedAt: 0 },
        ];

        const data: Compilation = {
            headings,
            excerpts,
            footnotes: [],
            collection: {} as any,
            contractVersion: '1.0',
            createdAt: 0,
            lastUpdatedAt: 0,
            sourceDocument: { pages: [], timestamp: new Date(0) },
        };

        const indexes = generateIndexes(data, 'test-collection');

        // sectionToExcerpts mapping
        expect(indexes.sectionToExcerpts!['test-collection']['H1']).toEqual(['P1', 'P2']);
        expect(indexes.sectionToExcerpts!['test-collection']['H2']).toEqual(['P3', 'P4']);

        // excerptToSection mapping
        expect(indexes.excerptToSection!['test-collection']['P1']).toBe('H1');
        expect(indexes.excerptToSection!['test-collection']['P2']).toBe('H1');
        expect(indexes.excerptToSection!['test-collection']['P3']).toBe('H2');
        expect(indexes.excerptToSection!['test-collection']['P4']).toBe('H2');

        // pageToHeading mapping
        expect(indexes.pageToHeading!['test-collection'][1]).toBe('H1');
        expect(indexes.pageToHeading!['test-collection'][10]).toBe('H2');

        // collectionToSections mapping
        expect(indexes.collectionToSections!['test-collection']).toEqual(['H1', 'H2']);
    });
});

describe('mergeIndexes', () => {
    it('should merge multiple partial indexes', () => {
        const partial1 = {
            sectionToExcerpts: { colA: { H1: ['P1'] } },
            excerptToSection: { colA: { P1: 'H1' } },
        };
        const partial2 = {
            sectionToExcerpts: { colA: { H2: ['P2'] } },
            excerptToSection: { colA: { P2: 'H2' } },
        };

        const merged = mergeIndexes(partial1, partial2);

        expect(merged.sectionToExcerpts['colA']['H1']).toEqual(['P1']);
        expect(merged.sectionToExcerpts['colA']['H2']).toEqual(['P2']);
        expect(merged.excerptToSection['colA']['P1']).toBe('H1');
        expect(merged.excerptToSection['colA']['P2']).toBe('H2');
    });
});

describe('addEntityMappings', () => {
    it('should add author mappings to indexes', () => {
        const indexes: LookupIndexes = {
            sectionToExcerpts: {},
            excerptToSection: {},
            pageToHeading: {},
            collectionToSections: {},
            sectionToChunks: {},
            excerptToChunk: {},
            entityToCollections: {},
        };

        addEntityMappings(indexes, 'collection-1', ['author-1', 'author-2']);
        addEntityMappings(indexes, 'collection-2', ['author-1']);

        expect(indexes.entityToCollections['author-1'].authorOf).toEqual(['collection-1', 'collection-2']);
        expect(indexes.entityToCollections['author-2'].authorOf).toEqual(['collection-1']);
    });
});
