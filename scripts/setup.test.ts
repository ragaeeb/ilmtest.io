import { describe, expect, it } from 'bun:test';
import type { Collection } from '@/types/excerpts';
import { normalizeQuranCompilation } from './quranCompilation';

const quranCollection: Collection = {
    id: '1',
    slug: 'quran',
    roman: "The Qur'an",
    unwan: 'القرآن الكريم',
    citationTemplate: 'https://quran.example/:surah/:ayah',
    authors: [],
    src: {
        id: '10',
        fid: '1',
    },
};

describe('normalizeQuranCompilation', () => {
    it('normalizes headings and excerpt membership from meta.headingId', () => {
        const result = normalizeQuranCompilation(
            {
                contractVersion: 'v4.0',
                createdAt: 100,
                lastUpdatedAt: 200,
                headings: [
                    {
                        id: 'T1',
                        nass: 'الفاتحة',
                        from: 1,
                        translator: 13,
                        lastUpdatedAt: 200,
                        text: 'Al-Fatihah',
                        meta: { num: 1 },
                    },
                    {
                        id: 'T2',
                        from: 2,
                        nass: 'البقرة',
                        translator: 13,
                        lastUpdatedAt: 200,
                        text: 'Al-Baqarah',
                        meta: { num: 2 },
                    },
                ],
                excerpts: [
                    {
                        nass: 'بِسْمِ ٱللَّهِ',
                        from: 1,
                        text: 'In the name of Allah',
                        translator: 13,
                        lastUpdatedAt: 200,
                        meta: { headingId: 'T1' },
                    },
                    {
                        nass: 'ٱلْحَمْدُ لِلَّهِ',
                        from: 2,
                        text: 'All praise is due to Allah',
                        translator: 13,
                        lastUpdatedAt: 200,
                        meta: { headingId: 'T1' },
                    },
                    {
                        nass: 'الٓمٓ',
                        from: 3,
                        text: 'Alif, Lam, Meem.',
                        translator: 13,
                        lastUpdatedAt: 200,
                        meta: { headingId: 'T2' },
                    },
                ],
                footnotes: [],
            },
            quranCollection,
        );

        expect(result.data.headings).toEqual([
            expect.objectContaining({ id: 'T1', from: 1 }),
            expect.objectContaining({ id: 'T2', from: 2 }),
        ]);
        expect(result.data.excerpts).toEqual([
            expect.objectContaining({ id: 'T1-1', meta: expect.objectContaining({ surah: 1, ayah: 1 }) }),
            expect.objectContaining({ id: 'T1-2', meta: expect.objectContaining({ surah: 1, ayah: 2 }) }),
            expect.objectContaining({ id: 'T2-1', meta: expect.objectContaining({ surah: 2, ayah: 1 }) }),
        ]);
        expect(result.explicitSectionToExcerpts).toEqual({
            T1: ['T1-1', 'T1-2'],
            T2: ['T2-1'],
        });
        expect(result.explicitExcerptToSection).toEqual({
            'T1-1': 'T1',
            'T1-2': 'T1',
            'T2-1': 'T2',
        });
    });

    it('throws when an excerpt references an unknown heading', () => {
        expect(() =>
            normalizeQuranCompilation(
                {
                    contractVersion: 'v4.0',
                    createdAt: 100,
                    lastUpdatedAt: 200,
                    headings: [
                        {
                            id: 'T1',
                            nass: 'الفاتحة',
                            text: 'Al-Fatihah',
                            translator: 13,
                            lastUpdatedAt: 200,
                            meta: { num: 1 },
                        },
                    ],
                    excerpts: [
                        {
                            nass: 'text',
                            text: 'translation',
                            translator: 13,
                            lastUpdatedAt: 200,
                            meta: { headingId: 'T9' },
                        },
                    ],
                    footnotes: [],
                },
                quranCollection,
            ),
        ).toThrow('unknown headingId T9');
    });
});
