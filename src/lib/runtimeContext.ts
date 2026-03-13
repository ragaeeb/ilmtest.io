import { env } from 'cloudflare:workers';
import type { DatasetManifest } from './datasetManifest';
import type { DatasetChannel } from './datasetPointer';
import { buildRuntimeCacheKey, runtimeCache } from './runtimeCache';
import {
    resolveRuntimeChannel as resolveConfiguredRuntimeChannel,
    resolveDatasetVersionOverride,
} from './runtimeEnvironment';
import { getErrorMessage, RuntimeDataError } from './runtimeErrors';
import { resolveDatasetManifest, resolveDatasetPointer } from './runtimeLoader';
import { logRuntimeSignal } from './runtimeSignals';

type BucketObject = {
    text(): Promise<string>;
};

type ExcerptBucket = {
    get(key: string): Promise<BucketObject | null>;
};

export type RuntimeContext = {
    channel: DatasetChannel;
    datasetVersion: string;
    manifest: DatasetManifest | null;
    manifestKey: string | null;
};

type RuntimeContextState = {
    datasetVersion: string;
    manifestKey: string | null;
    cacheStatus: 'hit' | 'miss' | 'local';
    localRuntime: boolean;
};

type LoadedRuntimeContext = {
    context: RuntimeContext;
    state: RuntimeContextState;
    message?: string;
};

const getExcerptBucket = (): ExcerptBucket | undefined => env.EXCERPT_BUCKET as ExcerptBucket | undefined;
const getConfiguredRuntimeChannel = () => env.ILMTEST_RUNTIME_CHANNEL;
const getDatasetVersionOverride = () => env.ILMTEST_DATASET_VERSION_OVERRIDE;
const isLocalRuntimeMode = () => import.meta.env.DEV || !getExcerptBucket();

export const readBucketJson = async <T>(
    key: string,
    details: {
        datasetVersion?: string;
        manifestKey?: string | null;
        collectionId?: string;
    } = {},
) => {
    const bucket = getExcerptBucket();
    if (!bucket) {
        throw new RuntimeDataError('binding-missing', `Missing EXCERPT_BUCKET binding for runtime artifact: ${key}`, {
            ...details,
            artifactKey: key,
        });
    }

    const object = await bucket.get(key);
    if (!object) {
        throw new RuntimeDataError('artifact-missing', `Missing runtime artifact in R2: ${key}`, {
            ...details,
            artifactKey: key,
        });
    }

    try {
        return JSON.parse(await object.text()) as T;
    } catch (error) {
        throw new RuntimeDataError(
            'invalid-artifact',
            `Invalid runtime artifact JSON at ${key}: ${getErrorMessage(error)}`,
            {
                ...details,
                artifactKey: key,
                statusCode: 500,
            },
        );
    }
};

export const resolveRuntimeChannel = (requestUrl?: string): DatasetChannel => {
    return resolveConfiguredRuntimeChannel({
        requestUrl,
        configuredChannel: getConfiguredRuntimeChannel(),
        isDev: import.meta.env.DEV,
    });
};

const resolveRuntimeContextR2Operation = (state: RuntimeContextState, status: 'ok' | 'error') => {
    if (state.localRuntime) {
        return undefined;
    }

    if (status === 'error') {
        return 'get';
    }

    return state.cacheStatus === 'miss' ? 'get' : undefined;
};

const logRuntimeContextResult = (
    state: RuntimeContextState,
    startedAt: number,
    status: 'ok' | 'error',
    message?: string,
) => {
    logRuntimeSignal({
        routeType: 'runtime-context',
        datasetVersion: state.datasetVersion,
        manifestKey: state.manifestKey ?? undefined,
        cacheStatus: state.cacheStatus,
        r2Operation: resolveRuntimeContextR2Operation(state, status),
        durationMs: Date.now() - startedAt,
        status,
        message,
    });
};

const buildLocalRuntimeContext = (channel: DatasetChannel): LoadedRuntimeContext => ({
    context: {
        channel,
        datasetVersion: 'local',
        manifest: null,
        manifestKey: null,
    },
    state: {
        datasetVersion: 'local',
        manifestKey: null,
        cacheStatus: 'local',
        localRuntime: true,
    },
});

const loadOverrideRuntimeContext = async (
    channel: DatasetChannel,
    datasetVersionOverride: string,
): Promise<LoadedRuntimeContext> => {
    if (isLocalRuntimeMode()) {
        throw new RuntimeDataError(
            'binding-missing',
            `Dataset version override requires the EXCERPT_BUCKET binding: ${datasetVersionOverride}`,
            {
                datasetVersion: datasetVersionOverride,
            },
        );
    }

    const manifestKey = `datasets/${datasetVersionOverride}/manifest.json`;
    const cacheKey = buildRuntimeCacheKey('manifest', manifestKey);
    const cacheStatus = runtimeCache.hasFresh(cacheKey) ? 'hit' : 'miss';
    const manifest = await resolveDatasetManifest(
        manifestKey,
        (key) => readBucketJson(key, { datasetVersion: datasetVersionOverride, manifestKey }),
        runtimeCache,
    );

    return {
        context: {
            channel,
            datasetVersion: manifest.datasetVersion,
            manifest,
            manifestKey,
        },
        state: {
            datasetVersion: manifest.datasetVersion,
            manifestKey,
            cacheStatus,
            localRuntime: false,
        },
        message: 'dataset-version override',
    };
};

const loadRemoteRuntimeContext = async (channel: DatasetChannel): Promise<LoadedRuntimeContext> => {
    const pointerCacheKey = buildRuntimeCacheKey('pointer', channel);
    const pointerCacheStatus = runtimeCache.hasFresh(pointerCacheKey) ? 'hit' : 'miss';
    const pointer = await resolveDatasetPointer(channel, (key) => readBucketJson(key), runtimeCache);
    const manifestKey = pointer.manifestKey;
    const manifestCacheKey = buildRuntimeCacheKey('manifest', manifestKey);
    const manifestCacheStatus = runtimeCache.hasFresh(manifestCacheKey) ? 'hit' : 'miss';
    const manifest = await resolveDatasetManifest(
        manifestKey,
        (key) => readBucketJson(key, { manifestKey }),
        runtimeCache,
    );
    const cacheStatus = pointerCacheStatus === 'hit' && manifestCacheStatus === 'hit' ? 'hit' : 'miss';

    return {
        context: {
            channel,
            datasetVersion: manifest.datasetVersion,
            manifest,
            manifestKey,
        },
        state: {
            datasetVersion: manifest.datasetVersion,
            manifestKey,
            cacheStatus,
            localRuntime: false,
        },
    };
};

export const loadRuntimeContext = async (requestUrl?: string): Promise<RuntimeContext> => {
    const startedAt = Date.now();
    const channel = resolveRuntimeChannel(requestUrl);
    const datasetVersionOverride = resolveDatasetVersionOverride({
        channel,
        datasetVersionOverride: getDatasetVersionOverride(),
        isDev: import.meta.env.DEV,
    });
    let state: RuntimeContextState = {
        datasetVersion: 'local',
        manifestKey: null,
        cacheStatus: isLocalRuntimeMode() ? 'local' : 'miss',
        localRuntime: isLocalRuntimeMode(),
    };

    try {
        const loadedContext = datasetVersionOverride
            ? await loadOverrideRuntimeContext(channel, datasetVersionOverride)
            : isLocalRuntimeMode()
              ? buildLocalRuntimeContext(channel)
              : await loadRemoteRuntimeContext(channel);

        state = loadedContext.state;
        logRuntimeContextResult(state, startedAt, 'ok', loadedContext.message);
        return loadedContext.context;
    } catch (error) {
        logRuntimeContextResult(state, startedAt, 'error', getErrorMessage(error));
        throw error;
    }
};
