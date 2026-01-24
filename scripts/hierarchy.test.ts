import { describe, expect, it } from 'bun:test';
import type { Compilation } from '../src/types/excerpts';
import { buildHierarchy, getTopLevelHeadings } from './hierarchy';

describe('buildHierarchy', () => {
    it('should handle scraped websites', () => {
        const compilation = {
            sourceDocument: { pages: [] }, // Web scraped (no titles)
            excerpts: [
                { id: 'P1', from: 1, nass: 'test1', text: 'Test 1', translator: 890, lastUpdatedAt: 0 },
                { id: 'P2', from: 1, nass: 'test2', text: 'Test 2', translator: 890, lastUpdatedAt: 0 },
                { id: 'P3', from: 2, nass: 'test3', text: 'Test 3', translator: 890, lastUpdatedAt: 0 },
            ],
            headings: [
                { id: 'T1', from: 1, nass: 'عنوان 1', text: 'Title 1', translator: 890, lastUpdatedAt: 0 },
                { id: 'T2', from: 2, nass: 'عنوان 2', text: 'Title 2', translator: 890, lastUpdatedAt: 0 },
            ],
        } as any;

        const actual = buildHierarchy(compilation);

        expect(actual).toMatchObject([
            {
                heading: { id: 'T1', from: 1, text: 'Title 1' },
                excerpts: [
                    { id: 'P1', from: 1, text: 'Test 1' },
                    { id: 'P2', from: 1, text: 'Test 2' },
                ],
            },
            {
                heading: { id: 'T2', from: 2, text: 'Title 2' },
                excerpts: [{ id: 'P3', from: 2, text: 'Test 3' }],
            },
        ]);
    });

    it('should handle Shamela books with flat structure', () => {
        const compilation = {
            sourceDocument: {
                titles: [
                    { id: 1, page: 1, content: 'Title 1' },
                    { id: 2, page: 5, content: 'Title 2' },
                ],
            },
            excerpts: [
                { id: 'P1', from: 1, nass: 'test1', text: 'Test 1', translator: 890, lastUpdatedAt: 0 },
                { id: 'P2', from: 3, nass: 'test2', text: 'Test 2', translator: 890, lastUpdatedAt: 0 },
                { id: 'P3', from: 5, nass: 'test3', text: 'Test 3', translator: 890, lastUpdatedAt: 0 },
            ],
            headings: [
                { id: 'T1', from: 1, nass: 'عنوان 1', text: 'Title 1', translator: 890, lastUpdatedAt: 0 },
                { id: 'T2', from: 5, nass: 'عنوان 2', text: 'Title 2', translator: 890, lastUpdatedAt: 0 },
            ],
        } as any;

        const actual = buildHierarchy(compilation);

        expect(actual).toHaveLength(2);
        expect(actual[0].heading.id).toBe('T1');
        expect(actual[1].heading.id).toBe('T2');
    });

    it('should handle Shamela books with nested structure', () => {
        const compilation = {
            sourceDocument: {
                titles: [
                    { id: 3, page: 9, content: 'بدء الوحي' },
                    { id: 4, page: 9, content: 'باب كيف كان بدء الوحي', parent: 3 },
                    { id: 5, page: 17, content: 'كتاب الإيمان' },
                    { id: 6, page: 17, content: 'باب قول النبي', parent: 5 },
                ],
            },
            excerpts: [
                { id: 'P9', from: 9, nass: 'test1', text: 'Test 1', translator: 890, lastUpdatedAt: 0 },
                { id: 'P10', from: 10, nass: 'test2', text: 'Test 2', translator: 890, lastUpdatedAt: 0 },
                { id: 'P17', from: 17, nass: 'test3', text: 'Test 3', translator: 890, lastUpdatedAt: 0 },
            ],
            headings: [
                {
                    id: 'T3',
                    from: 9,
                    nass: 'بدء الوحي',
                    text: 'Beginning of Revelation',
                    translator: 891,
                    lastUpdatedAt: 0,
                },
                {
                    id: 'T4',
                    from: 9,
                    nass: 'باب كيف كان بدء الوحي',
                    text: 'Chapter: How revelation began',
                    translator: 891,
                    lastUpdatedAt: 0,
                },
                { id: 'T5', from: 17, nass: 'كتاب الإيمان', text: 'Book of Faith', translator: 891, lastUpdatedAt: 0 },
                {
                    id: 'T6',
                    from: 17,
                    nass: 'باب قول النبي',
                    text: 'Chapter: Prophets saying',
                    translator: 891,
                    lastUpdatedAt: 0,
                },
            ],
        } as Compilation;

        const actual = buildHierarchy(compilation);

        expect(actual).toHaveLength(4);

        // Verify parent/child relationships are preserved
        const t3 = actual.find((h) => h.heading.id === 'T3')!;
        const t4 = actual.find((h) => h.heading.id === 'T4')!;

        expect(t3.heading).not.toHaveProperty('parent');
        // T4 should have parent reference after range computation
    });
});

describe('getTopLevelHeadings', () => {
    it('should filter headings without parents', () => {
        const headings = [
            { id: 'T1', from: 1, nass: 'test', text: 'Test 1', translator: 890, lastUpdatedAt: 0 },
            { id: 'T2', from: 5, nass: 'test', text: 'Test 2', translator: 890, lastUpdatedAt: 0, parent: 'T1' },
            { id: 'T3', from: 10, nass: 'test', text: 'Test 3', translator: 890, lastUpdatedAt: 0 },
        ] as any[];

        const topLevel = getTopLevelHeadings(headings);

        expect(topLevel).toHaveLength(2);
        expect(topLevel[0].id).toBe('T1');
        expect(topLevel[1].id).toBe('T3');
    });

    it('should return all headings if none have parents', () => {
        const headings = [
            { id: 'T1', from: 1, nass: 'test', text: 'Test 1', translator: 890, lastUpdatedAt: 0 },
            { id: 'T2', from: 5, nass: 'test', text: 'Test 2', translator: 890, lastUpdatedAt: 0 },
        ] as any[];

        const topLevel = getTopLevelHeadings(headings);

        expect(topLevel).toHaveLength(2);
    });

    it('should return empty array for empty input', () => {
        const topLevel = getTopLevelHeadings([]);
        expect(topLevel).toEqual([]);
    });
});
