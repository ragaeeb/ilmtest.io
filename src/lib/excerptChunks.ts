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
    chunkIndex: number;
    excerptIds: string[];
    excerpts: Excerpt[];
};

const resolveModuleFilePath = (relativePath: string) => {
    const pathname = decodeURIComponent(new URL(relativePath, import.meta.url).pathname);
    return pathname.replace(/^\/([A-Za-z]:\/)/, '$1');
};

const localChunkModules = import.meta.env.DEV
    ? (import.meta.glob('../../tmp/excerpt-chunks/**/*.json', {
          import: 'default',
      }) as Record<string, () => Promise<unknown>>)
    : {};

const getExcerptBucket = (): ExcerptBucket | undefined => env.EXCERPT_BUCKET as ExcerptBucket | undefined;

const readLocalChunk = async (chunkKey: string) => {
    if (import.meta.env.DEV) {
        const match = Object.entries(localChunkModules).find(([path]) => path.endsWith(`/${chunkKey}`));
        return ((await match?.[1]()) as ChunkPayload | undefined) ?? null;
    }

    const filePath = resolveModuleFilePath(`../../tmp/excerpt-chunks/${chunkKey}`);

    if (typeof Bun !== 'undefined') {
        const file = Bun.file(filePath);
        if (!(await file.exists())) {
            return null;
        }

        return (await file.json()) as ChunkPayload;
    }

    return null;
};

const logChunkFetch = (details: {
    datasetVersion?: string;
    cacheStatus: 'hit' | 'miss' | 'local';
    chunkKey: string;
    startedAt: number;
    status: 'ok' | 'error';
    message?: string;
    r2Operation?: string;
}) => {
    logRuntimeSignal({
        routeType: 'chunk-fetch',
        datasetVersion: details.datasetVersion,
        cacheStatus: details.cacheStatus,
        chunkKey: details.chunkKey,
        r2Operation: details.r2Operation,
        durationMs: Date.now() - details.startedAt,
        status: details.status,
        message: details.message,
    });
};

const loadLocalChunkWithSignal = async (
    chunkKey: string,
    datasetVersion: string | undefined,
    startedAt: number,
    messagePrefix: string,
) => {
    const chunk = await readLocalChunk(chunkKey);
    logChunkFetch({
        datasetVersion: datasetVersion ?? 'local',
        cacheStatus: 'local',
        chunkKey,
        startedAt,
        status: chunk ? 'ok' : 'error',
        message: chunk ? undefined : `${messagePrefix} ${chunkKey}`,
    });
    return chunk;
};

const loadRemoteChunk = async (bucket: ExcerptBucket, chunkKey: string, datasetVersion: string, startedAt: number) => {
    const object = await bucket.get(`datasets/${datasetVersion}/chunks/${chunkKey}`);
    if (!object) {
        logChunkFetch({
            datasetVersion,
            cacheStatus: 'miss',
            chunkKey,
            startedAt,
            status: 'error',
            message: `Missing remote chunk payload for ${chunkKey}`,
            r2Operation: 'get',
        });
        return null;
    }

    const chunk = JSON.parse(await object.text()) as ChunkPayload;
    logChunkFetch({
        datasetVersion,
        cacheStatus: 'miss',
        chunkKey,
        startedAt,
        status: 'ok',
        r2Operation: 'get',
    });
    return chunk;
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
            return loadLocalChunkWithSignal(chunkKey, datasetVersion, startedAt, 'Missing local chunk payload for');
        }

        const bucket = getExcerptBucket();
        if (!bucket) {
            return loadLocalChunkWithSignal(
                chunkKey,
                datasetVersion,
                startedAt,
                'Missing fallback local chunk payload for',
            );
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

        return await loadRemoteChunk(bucket, chunkKey, datasetVersion, startedAt);
    } catch (error) {
        logChunkFetch({
            datasetVersion: datasetVersion ?? (localRuntime ? 'local' : undefined),
            cacheStatus: localRuntime ? 'local' : 'miss',
            chunkKey,
            startedAt,
            status: 'error',
            message: getErrorMessage(error),
            r2Operation: localRuntime ? undefined : 'get',
        });
        throw error;
    }
};
