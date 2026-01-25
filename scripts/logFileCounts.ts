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

const walk = async (dir: string): Promise<number> => {
    let count = 0;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            count += await walk(fullPath);
        } else {
            const info = await stat(fullPath);
            if (info.isFile()) {
                count += 1;
            }
        }
    }
    return count;
};

const main = async () => {
    const distDir = join(process.cwd(), 'dist');
    const publicChunks = join(process.cwd(), 'tmp', 'excerpt-chunks');

    // #region agent log
    await log({
        hypothesisId: 'H1',
        location: 'scripts/logFileCounts.ts:38',
        message: 'file-count-start',
        data: { distDir, publicChunks },
    });
    // #endregion

    let distCount = 0;
    let chunkCount = 0;
    try {
        distCount = await walk(distDir);
    } catch {
        distCount = -1;
    }
    try {
        chunkCount = await walk(publicChunks);
    } catch {
        chunkCount = -1;
    }

    // #region agent log
    await log({
        hypothesisId: 'H1',
        location: 'scripts/logFileCounts.ts:60',
        message: 'file-count-summary',
        data: { distCount, chunkCount, total: distCount + chunkCount },
    });
    // #endregion
};

await main();
