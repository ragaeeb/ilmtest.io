import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const bucketName = process.argv[2] ?? process.env.R2_BUCKET;
const baseDir = process.argv[3] ?? process.env.R2_BASE_DIR ?? 'tmp/excerpt-chunks';
const concurrency = Math.max(1, Number(process.env.R2_CONCURRENCY ?? '8'));
const useRemote = process.env.R2_REMOTE === '1';
const limit = Math.max(0, Number(process.env.R2_LIMIT ?? '0'));
const progressEvery = Math.max(1, Number(process.env.R2_PROGRESS_EVERY ?? '50'));
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

if (!bucketName) {
    console.error('Usage: bun scripts/uploadR2.ts <bucket> [baseDir]');
    process.exit(1);
}

const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await walk(fullPath)));
        } else {
            files.push(fullPath);
        }
    }
    return files;
};

const main = async () => {
    const allFiles = await walk(baseDir);
    const files = limit > 0 ? allFiles.slice(0, limit) : allFiles;
    let failures = 0;
    let successes = 0;
    let lastLogged = 0;

    // #region agent log
    await log({
        hypothesisId: 'H1',
        location: 'scripts/uploadR2.ts:39',
        message: 'upload-start',
        data: { bucketName, baseDir, concurrency, useRemote, fileCount: files.length },
    });
    // #endregion

    let index = 0;

    const runOne = async () => {
        while (index < files.length) {
            const filePath = files[index++];
            const key = relative(baseDir, filePath).replace(/\\/g, '/');
            const args = [
                'wrangler',
                'r2',
                'object',
                'put',
                `${bucketName}/${key}`,
                '--file',
                filePath,
                '--content-type',
                'application/json',
            ];
            if (useRemote) {
                args.push('--remote');
            }
            const proc = Bun.spawn(
                args,
                { stdout: 'inherit', stderr: 'inherit' },
            );
            const code = await proc.exited;
            if (code !== 0) {
                failures += 1;
                // #region agent log
                await log({
                    hypothesisId: 'H3',
                    location: 'scripts/uploadR2.ts:77',
                    message: 'upload-error',
                    data: { key },
                });
                // #endregion
            } else {
                successes += 1;
            }
            const completed = successes + failures;
            if (
                completed > lastLogged
                && (completed === files.length || completed - lastLogged >= progressEvery)
            ) {
                lastLogged = completed;
                const remaining = files.length - completed;
                console.log(
                    `[uploadR2] ${completed}/${files.length} done (${remaining} remaining, ${successes} ok, ${failures} failed)`,
                );
            }
        }
    };

    const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => runOne());
    await Promise.all(workers);

    // #region agent log
    await log({
        hypothesisId: 'H2',
        location: 'scripts/uploadR2.ts:81',
        message: 'upload-complete',
        data: { successes, failures },
    });
    // #endregion

    if (failures > 0) {
        process.exit(1);
    }
};

await main();
