import { describe, expect, it } from 'bun:test';
import { buildHierarchy } from './builder';

describe('buildHierarchy', () => {
    it('should handle scraped websites', () => {
        const compilation = {
            sourceDocument: {},
            excerpts: [
                { from: 1, text: 'P1' },
                { from: 1, text: 'P2' },
                { from: 2, text: 'P3' },
            ],
            headings: [
                { from: 1, text: 'T1' },
                { from: 2, text: 'T2' },
            ],
        } as any;

        const actual = buildHierarchy(compilation);

        expect(actual).toMatchObject([
            {
                heading: { from: 1, text: 'T1' },
                excerpts: [
                    { from: 1, text: 'P1' },
                    { from: 1, text: 'P2' },
                ],
            },
            { heading: { from: 2, text: 'T2' }, excerpts: [{ from: 2, text: 'P3' }] },
        ]);
    });

    it('should handle flat shamela books', () => {
        const compilation = {
            sourceDocument: { titles: [{ id: 1 }, { id: 2 }] },
            excerpts: [
                { from: 1, text: 'P1' },
                { from: 2, text: 'P2' },
            ],
            headings: [
                { from: 1, text: 'T1' },
                { from: 2, text: 'T2' },
            ],
        } as any;

        const actual = buildHierarchy(compilation);

        expect(actual).toMatchObject([
            {
                heading: { from: 1, text: 'T1' },
                excerpts: [{ from: 1, text: 'P1' }],
            },
            { heading: { from: 2, text: 'T2' }, excerpts: [{ from: 2, text: 'P3' }] },
        ]);
    });

    it('should place excerpts under sub-headings when a heading and its child are on the same page along with the excerpt', () => {
        const compilation = {
            sourceDocument: {
                titles: [
                    { id: 1, page: 9 },
                    { id: 2, parent: 1, page: 9 },
                ],
            },
            excerpts: [{ from: 1, text: 'P1' }],
            headings: [
                { from: 9, text: 'T1' },
                { from: 9, text: 'Nested' },
            ],
        } as any;

        const actual = buildHierarchy(compilation);

        expect(actual).toMatchObject([
            {
                heading: { from: 9, text: 'T1' },
                excerpts: [{ from: 9, text: 'P1' }],
            },
        ]);
    });
});
