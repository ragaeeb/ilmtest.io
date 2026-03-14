import type { Excerpt } from '@/types/excerpts';

export type ExcerptLocator = {
    label: 'Page' | 'Verse';
    value: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const getExcerptLocator = (excerpt: Excerpt): ExcerptLocator => {
    const meta = excerpt.meta;

    if (isRecord(meta) && 'ayah' in meta && typeof meta.ayah === 'number') {
        return {
            label: 'Verse',
            value: meta.ayah,
        };
    }

    return {
        label: 'Page',
        value: excerpt.from,
    };
};
