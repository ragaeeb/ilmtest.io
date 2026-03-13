import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Collection, Excerpt } from '@/types/excerpts';
import { buildSearchIndex, buildSearchRecord } from './buildSearchIndex';

const makeExcerpt = (overrides: Partial<Excerpt> = {}): Excerpt => ({
    id: 'exc-1',
    from: 42,
    nass: 'بسم الله الرحمن الرحيم',
    text: 'In the name of Allah, the Most Gracious, the Most Merciful',
    translator: 1,
    lastUpdatedAt: 1700000000,
    ...overrides,
});

const makeCollection = (overrides: Partial<Collection> = {}): Collection => ({
    id: '100',
    slug: 'riyad-saliheen-nawawi',
    roman: 'Riyadh al-Saliheen',
    unwan: 'رياض الصالحين',
    citationTemplate: 'https://shamela.ws/book/1234/:page',
    src: { id: '75', fid: '1234' },
    authors: [
        {
            id: '10',
            name: 'Imam al-Nawawi',
            ism: 'الإمام النووي',
        },
    ],
    ...overrides,
});

describe('buildSearchRecord', () => {
    test('produces a record with correct URL', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt({ id: 'exc-1' }),
            collection: makeCollection({ slug: 'riyad-saliheen-nawawi' }),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.url).toBe('/browse/riyad-saliheen-nawawi/sec-1/e/exc-1');
    });

    test('includes Arabic text in content', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.content).toContain('بسم الله');
    });

    test('includes English translation in content', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.content).toContain('In the name of Allah');
    });

    test('separates Arabic and English with divider', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.content).toContain('---');
    });

    test('sets language to ar when Arabic text is present', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.language).toBe('ar');
    });

    test('sets language to en when only English text is present', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt({ nass: '' }),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.language).toBe('en');
    });

    test('sets collection filter', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection({ slug: 'my-book' }),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.filters.collection).toEqual(['my-book']);
    });

    test('sets language filter to both when bilingual', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.filters.language).toContain('ar');
        expect(record.filters.language).toContain('en');
    });

    test('sets section filter with collection, section id, and title', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection({ slug: 'my-book' }),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.filters.section[0]).toBe('my-book::sec-1::Chapter%201');
    });

    test('sets page sort as string', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt({ from: 99 }),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.sort.page).toBe('99');
    });

    test('includes collection metadata in meta', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection({ unwan: 'رياض الصالحين' }),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.meta.collectionTitle).toBe('رياض الصالحين');
    });

    test('includes section title in meta', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'فضل العلم',
        });

        expect(record.meta.sectionTitle).toBe('فضل العلم');
    });

    test('includes author name in meta', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.meta.authorName).toBe('Imam al-Nawawi');
    });

    test('builds display title from section title and author', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Book of Knowledge',
        });

        expect(record.meta.title).toBe('Book of Knowledge — Imam al-Nawawi');
    });

    test('uses content preview as title when section title is generic', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt({ id: 'sec-1', text: 'A short text' }),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Section sec-1',
        });

        expect(record.meta.title).toBe('A short text');
    });

    test('truncates very long content', () => {
        const longText = 'x'.repeat(5000);
        const record = buildSearchRecord({
            excerpt: makeExcerpt({ nass: longText }),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.content.length).toBeLessThan(longText.length);
        expect(record.content).toContain('…');
    });

    test('handles excerpt with only Arabic text', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt({ text: '' }),
            collection: makeCollection(),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.content).toContain('بسم الله');
        expect(record.content).not.toContain('---');
        expect(record.language).toBe('ar');
        expect(record.filters.language).toEqual(['ar']);
    });

    test('handles collection with no authors gracefully', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection({ authors: [] }),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.meta.authorName).toBe('');
    });

    test('includes collection slug in meta', () => {
        const record = buildSearchRecord({
            excerpt: makeExcerpt(),
            collection: makeCollection({ slug: 'sahih-bukhari' }),
            sectionId: 'sec-1',
            sectionTitle: 'Chapter 1',
        });

        expect(record.meta.collectionSlug).toBe('sahih-bukhari');
    });
});

describe('buildSearchIndex', () => {
    test('writes a Pagefind index for a minimal fixture corpus', async () => {
        const tempRoot = await mkdtemp(join(tmpdir(), 'ilmtest-search-'));

        try {
            const dataDir = join(tempRoot, 'src', 'data');
            const chunksDir = join(tempRoot, 'tmp', 'excerpt-chunks', 'col-1');

            await mkdir(dataDir, { recursive: true });
            await mkdir(chunksDir, { recursive: true });

            const collection = makeCollection({ id: 'col-1', slug: 'riyad-saliheen-nawawi' });

            await Bun.write(join(dataDir, 'collections.json'), JSON.stringify([collection], null, 2));
            await Bun.write(join(dataDir, 'translators.json'), JSON.stringify([], null, 2));

            const chunkKey = 'col-1/sec-1-0.json';
            await Bun.write(
                join(tempRoot, 'tmp', 'excerpt-chunks', chunkKey),
                JSON.stringify(
                    {
                        sectionId: 'sec-1',
                        chunkIndex: 0,
                        excerptIds: ['sec-1', 'exc-1'],
                        excerpts: [
                            makeExcerpt({ id: 'sec-1', text: 'Chapter 1', nass: 'الفصل الأول', from: 1 }),
                            makeExcerpt({ id: 'exc-1', from: 2 }),
                        ],
                    },
                    null,
                    2,
                ),
            );

            await Bun.write(
                join(dataDir, 'indexes.json'),
                JSON.stringify(
                    {
                        sectionToExcerpts: { 'col-1': { 'sec-1': ['exc-1'] } },
                        excerptToSection: { 'col-1': { 'exc-1': 'sec-1' } },
                        pageToHeading: { 'col-1': { 1: 'sec-1' } },
                        collectionToSections: { 'col-1': ['sec-1'] },
                        sectionToChunks: { 'col-1': { 'sec-1': [chunkKey] } },
                        excerptToChunk: { 'col-1': { 'exc-1': chunkKey } },
                        entityToCollections: {},
                    },
                    null,
                    2,
                ),
            );

            const outputPath = join(tempRoot, 'dist', 'dist', 'pagefind');
            await buildSearchIndex(outputPath, tempRoot);

            const listFiles = async (dir: string): Promise<string[]> => {
                const entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true }).catch(() => []);
                const results: string[] = [];

                for (const entry of entries) {
                    const fullPath = join(dir, entry.name);
                    if (entry.isDirectory()) {
                        results.push(...(await listFiles(fullPath)));
                    } else {
                        results.push(fullPath);
                    }
                }

                return results;
            };

            const files = await listFiles(outputPath);
            expect(files.length).toBeGreaterThan(0);
            expect(files.some((file) => file.endsWith('pagefind.js') || file.endsWith('pagefind-entry.json'))).toBe(
                true,
            );
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });
});
