import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SESSION = 'debug-session';
const RUN_ID = 'pre-fix';
const ENDPOINT = 'http://127.0.0.1:7242/ingest/52426cdf-aa70-46f4-bea3-a95a3d7c7923';

const log = (payload: Record<string, unknown>) => {
    return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            timestamp: Date.now(),
            sessionId: SESSION,
            runId: RUN_ID,
            ...payload,
        }),
    }).catch(() => {});
};

const main = async () => {
    const baseDir = join(process.cwd(), 'dist', '_worker.js');
    const chunksDir = join(baseDir, 'chunks');

    // #region agent log
    await log({
        hypothesisId: 'H1',
        location: 'scripts/logBundleSize.ts:24',
        message: 'bundle-scan-start',
        data: { baseDir, chunksDir },
    });
    // #endregion

    const chunkFiles = await readdir(chunksDir);
    const sizes = await Promise.all(
        chunkFiles.map(async (name) => {
            const filePath = join(chunksDir, name);
            const info = await stat(filePath);
            return { name, size: info.size };
        }),
    );

    const totalChunksSize = sizes.reduce((sum, item) => sum + item.size, 0);
    const sorted = [...sizes].sort((a, b) => b.size - a.size);
    const top = sorted.slice(0, 5);
    const dataLayer = sizes.find((item) => item.name.startsWith('_astro_data-layer-content'));
    const indexesChunk = sizes.find((item) => item.name.startsWith('indexes_'));

    // #region agent log
    await log({
        hypothesisId: 'H1',
        location: 'scripts/logBundleSize.ts:46',
        message: 'bundle-chunks-summary',
        data: {
            chunkCount: sizes.length,
            totalChunksSize,
            dataLayerSize: dataLayer?.size ?? null,
            indexesChunkSize: indexesChunk?.size ?? null,
        },
    });
    // #endregion

    // #region agent log
    await log({
        hypothesisId: 'H2',
        location: 'scripts/logBundleSize.ts:59',
        message: 'bundle-top-chunks',
        data: { top },
    });
    // #endregion

    const baseFiles = await readdir(baseDir);
    const baseSizes = await Promise.all(
        baseFiles.map(async (name) => {
            const filePath = join(baseDir, name);
            const info = await stat(filePath);
            return { name, size: info.size };
        }),
    );

    // #region agent log
    await log({
        hypothesisId: 'H3',
        location: 'scripts/logBundleSize.ts:74',
        message: 'bundle-base-files',
        data: { baseFiles: baseSizes },
    });
    // #endregion
};

await main();
