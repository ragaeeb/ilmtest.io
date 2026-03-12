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

const LOCAL_CHUNKS_ROOT = new URL('../../tmp/excerpt-chunks/', import.meta.url).pathname;
const localChunkModules = import.meta.env.DEV
    ? (import.meta.glob('../../tmp/excerpt-chunks/**/*.json', {
          eager: true,
          import: 'default',
      }) as Record<string, unknown>)
    : {};

const getExcerptBucket = (): ExcerptBucket | undefined => env.EXCERPT_BUCKET as ExcerptBucket | undefined;

const readLocalChunk = async (chunkKey: string) => {
    if (import.meta.env.DEV) {
        const match = Object.entries(localChunkModules).find(([path]) => path.endsWith(`/${chunkKey}`));
        return (match?.[1] as ChunkPayload | undefined) ?? null;
    }

    const filePath = `${LOCAL_CHUNKS_ROOT}${chunkKey}`;

    if (typeof Bun !== 'undefined') {
        const file = Bun.file(filePath);
        if (!(await file.exists())) {
            return null;
        }

        return (await file.json()) as ChunkPayload;
    }

    return null;
};

export const fetchExcerptChunk = async (
    chunkKey: string,
    _requestUrl?: string,
    datasetVersion?: string,
): Promise<ChunkPayload | null> => {
    if (import.meta.env.DEV) {
        return readLocalChunk(chunkKey);
    }

    const bucket = getExcerptBucket();
    if (!bucket) {
        return readLocalChunk(chunkKey);
    }

    if (!datasetVersion) {
        throw new Error(`Remote chunk fetch requires a datasetVersion for ${chunkKey}`);
    }

    const object = await bucket.get(`datasets/${datasetVersion}/chunks/${chunkKey}`);
    if (!object) {
        return null;
    }

    return JSON.parse(await object.text()) as ChunkPayload;
};
