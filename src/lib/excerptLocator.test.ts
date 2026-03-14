import { describe, expect, it } from 'bun:test';
import type { Excerpt } from '@/types/excerpts';
import { getExcerptLocator } from './excerptLocator';

const createExcerpt = (overrides: Partial<Excerpt> = {}): Excerpt => ({
    id: 'E1',
    nass: 'test',
    text: 'test',
    from: 12,
    translator: 1,
    lastUpdatedAt: 1,
    ...overrides,
});

describe('getExcerptLocator', () => {
    it('returns a verse locator for Qur’an excerpts', () => {
        const excerpt = createExcerpt({
            meta: { surah: 2, ayah: 255, surahName: 'Al-Baqarah' },
        });

        expect(getExcerptLocator(excerpt)).toEqual({
            label: 'Verse',
            value: 255,
        });
    });

    it('returns a page locator for non-Qur’an excerpts', () => {
        const excerpt = createExcerpt({
            from: 100,
            meta: { vol: 2, vp: 93 },
        });

        expect(getExcerptLocator(excerpt)).toEqual({
            label: 'Page',
            value: 93,
        });
    });
});
