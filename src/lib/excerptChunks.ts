import { env } from 'cloudflare:workers';
import type { Excerpt } from '@/types/excerpts';

type BucketObject = {
    text(): Promise<string>;
};

type ExcerptBucket = {
    get(key: string): Promise<BucketObject | null>;
};

export type ChunkPayload = {
    sectionId: string;
    excerptIds: string[];
    excerpts: Excerpt[];
};

const getExcerptBucket = (): ExcerptBucket | undefined => env.EXCERPT_BUCKET as ExcerptBucket | undefined;

export const fetchExcerptChunk = async (chunkId: string, requestUrl?: string): Promise<ChunkPayload | null> => {
    if (import.meta.env.DEV && requestUrl) {
        const filePath = new URL(`../../tmp/excerpt-chunks/${chunkId}`, import.meta.url).pathname;
        const response = await fetch(new URL(`/@fs${filePath}`, requestUrl));

        if (response.ok) {
            return (await response.json()) as ChunkPayload;
        }
    }

    const bucket = getExcerptBucket();
    if (bucket) {
        const object = await bucket.get(chunkId);
        if (!object) {
            return null;
        }

        return JSON.parse(await object.text()) as ChunkPayload;
    }

    return null;
};
