export type RuntimeSignal = {
    routeType?: string;
    datasetVersion?: string;
    manifestKey?: string;
    collectionId?: string;
    cacheStatus?: 'hit' | 'miss' | 'local';
    chunkKey?: string;
    r2Operation?: string;
    durationMs: number;
    status: 'ok' | 'error';
    message?: string;
};

export const logRuntimeSignal = (signal: RuntimeSignal) => {
    console.info(
        `[runtime] ${JSON.stringify({
            ...signal,
            ts: new Date().toISOString(),
        })}`,
    );
};
