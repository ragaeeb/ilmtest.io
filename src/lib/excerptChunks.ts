import { env } from 'cloudflare:workers';
import type { Excerpt } from '@/types/excerpts';
import { getErrorMessage, RuntimeDataError } from './runtimeErrors';
import { logRuntimeSignal } from './runtimeSignals';

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
    const startedAt = Date.now();
    const localRuntime = import.meta.env.DEV;

    try {
        if (localRuntime) {
            const chunk = await readLocalChunk(chunkKey);
            logRuntimeSignal({
                routeType: 'chunk-fetch',
                datasetVersion: datasetVersion ?? 'local',
                cacheStatus: 'local',
                chunkKey,
                durationMs: Date.now() - startedAt,
                status: chunk ? 'ok' : 'error',
                message: chunk ? undefined : `Missing local chunk payload for ${chunkKey}`,
            });
            return chunk;
        }

        const bucket = getExcerptBucket();
        if (!bucket) {
            const chunk = await readLocalChunk(chunkKey);
            logRuntimeSignal({
                routeType: 'chunk-fetch',
                datasetVersion: datasetVersion ?? 'local',
                cacheStatus: 'local',
                chunkKey,
                durationMs: Date.now() - startedAt,
                status: chunk ? 'ok' : 'error',
                message: chunk ? undefined : `Missing fallback local chunk payload for ${chunkKey}`,
            });
            return chunk;
        }

        if (!datasetVersion) {
            throw new RuntimeDataError(
                'chunk-missing',
                `Remote chunk fetch requires a datasetVersion for ${chunkKey}`,
                {
                    chunkKey,
                },
            );
        }

        const object = await bucket.get(`datasets/${datasetVersion}/chunks/${chunkKey}`);
        if (!object) {
            logRuntimeSignal({
                routeType: 'chunk-fetch',
                datasetVersion,
                cacheStatus: 'miss',
                chunkKey,
                r2Operation: 'get',
                durationMs: Date.now() - startedAt,
                status: 'error',
                message: `Missing remote chunk payload for ${chunkKey}`,
            });
            return null;
        }

        const chunk = JSON.parse(await object.text()) as ChunkPayload;
        logRuntimeSignal({
            routeType: 'chunk-fetch',
            datasetVersion,
            cacheStatus: 'miss',
            chunkKey,
            r2Operation: 'get',
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return chunk;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'chunk-fetch',
            datasetVersion: datasetVersion ?? (localRuntime ? 'local' : undefined),
            cacheStatus: localRuntime ? 'local' : 'miss',
            chunkKey,
            r2Operation: localRuntime ? undefined : 'get',
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
};
