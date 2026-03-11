import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { S3Client } from 'bun';

const argvBucket = process.argv[2]?.trim();
const argvBaseDir = process.argv[3]?.trim();
const bucketName = argvBucket ? argvBucket : process.env.R2_BUCKET;
const baseDir = argvBaseDir ? argvBaseDir : (process.env.R2_BASE_DIR ?? 'tmp/excerpt-chunks');
const concurrency = Math.max(1, Number(process.env.R2_CONCURRENCY ?? '8'));
const useRemote = process.env.R2_REMOTE === '1';
const limit = Math.max(0, Number(process.env.R2_LIMIT ?? '0'));
const progressEvery = Math.max(1, Number(process.env.R2_PROGRESS_EVERY ?? '50'));
const requireConfirm = process.env.R2_REQUIRE_CONFIRM === '1';
const dryRun = process.env.R2_DRY_RUN === '1';
const retry429 = Math.max(0, Number(process.env.R2_RETRY_429 ?? '3'));
const wranglerVerbose = process.env.R2_WRANGLER_VERBOSE === '1';
const skipExisting = process.env.R2_SKIP_EXISTING === '1';
const listPrefix = process.env.R2_LIST_PREFIX ?? '';
const cfApiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
let accountId = process.env.R2_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID ?? '';
let accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? '';
let secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '';
let r2Endpoint =
    process.env.R2_ENDPOINT ??
    process.env.S3_ENDPOINT ??
    process.env.AWS_ENDPOINT ??
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
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

const resolveAccountIdFromToken = async (): Promise<string | null> => {
    if (!cfApiToken || accountId) {
        return accountId || null;
    }
    try {
        const response = await fetch('https://api.cloudflare.com/client/v4/accounts', {
            headers: { Authorization: `Bearer ${cfApiToken}` },
        });
        const payload = await response.json();
        const accounts = payload?.result ?? [];
        if (accounts.length === 1 && accounts[0]?.id) {
            return accounts[0].id;
        }
    } catch {
        // ignore resolution errors
    }
    return null;
};

const resolveS3AccessFromToken = async (): Promise<string | null> => {
    if (!cfApiToken) {
        return null;
    }
    try {
        const response = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
            headers: { Authorization: `Bearer ${cfApiToken}` },
        });
        const payload = await response.json();
        const tokenId = payload?.result?.id;
        if (tokenId) {
            accessKeyId = accessKeyId || tokenId;
            secretAccessKey = secretAccessKey || createHash('sha256').update(cfApiToken).digest('hex');
            return tokenId;
        }
    } catch {
        // ignore resolution errors
    }
    return null;
};

const ensureR2Credentials = async () => {
    if (!cfApiToken) {
        return;
    }
    const resolvedAccountId = await resolveAccountIdFromToken();
    if (resolvedAccountId && !accountId) {
        accountId = resolvedAccountId;
    }
    if (!r2Endpoint && accountId) {
        r2Endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    }
    if (!accessKeyId || !secretAccessKey) {
        await resolveS3AccessFromToken();
    }
};

// #region agent log
await log({
    hypothesisId: 'H4',
    location: 'scripts/uploadR2.ts:26',
    message: 'debug-early-args',
    data: {
        argvBucket: process.argv[2] ?? null,
        argvBaseDir: process.argv[3] ?? null,
        envBucket: process.env.R2_BUCKET ?? null,
        envBaseDir: process.env.R2_BASE_DIR ?? null,
    },
});
// #endregion

if (!bucketName) {
    console.error('Usage: bun scripts/uploadR2.ts <bucket> [baseDir]');
    process.exit(1);
}
if (bucketName === baseDir && !process.env.R2_BUCKET && process.argv.length <= 3) {
    console.error(
        'Bucket name missing. It looks like you passed the baseDir as the first argument. Usage: bun scripts/uploadR2.ts <bucket> [baseDir]',
    );
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

const shouldFetchExistingKeys = (): { ok: boolean; reason?: string } => {
    if (!skipExisting) {
        return { ok: false, reason: 'skipExisting=false' };
    }
    if (!r2Endpoint) {
        console.warn(
            '[uploadR2] R2_SKIP_EXISTING=1 but missing R2_ENDPOINT or R2_ACCOUNT_ID/CF_ACCOUNT_ID. Skipping existing check.',
        );
        return { ok: false, reason: 'missing-endpoint' };
    }
    if (!accessKeyId || !secretAccessKey) {
        console.warn(
            '[uploadR2] R2_SKIP_EXISTING=1 but missing access keys (R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY or S3_*/AWS_*). Skipping existing check.',
        );
        return { ok: false, reason: 'missing-keys' };
    }
    return { ok: true };
};

const fetchExistingKeys = async (bucket: string): Promise<{ keys: Set<string>; reason?: string }> => {
    const guard = shouldFetchExistingKeys();
    if (!guard.ok) {
        if (skipExisting) {
            console.warn('[uploadR2] Skip-existing enabled but list is disabled.');
        }
        return { keys: new Set<string>(), reason: guard.reason };
    }
    console.log('[uploadR2] Listing existing objects from R2...');
    const client = new S3Client({
        bucket,
        endpoint: r2Endpoint,
        ...(accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : {}),
    });
    const keys = new Set<string>();
    let token: string | undefined;
    do {
        const response = await client.list({
            prefix: listPrefix || undefined,
            continuationToken: token,
        });
        for (const entry of response.contents ?? []) {
            if (entry.key) {
                keys.add(entry.key);
            }
        }
        token = response.isTruncated ? response.nextContinuationToken : undefined;
    } while (token);
    console.log(`[uploadR2] Found ${keys.size} existing objects.`);
    return { keys };
};

const main = async () => {
    const allFiles = await walk(baseDir);
    const files = limit > 0 ? allFiles.slice(0, limit) : allFiles;
    let failures = 0;
    let successes = 0;
    let skipped = 0;
    let lastLogged = 0;

    // #region agent log
    await log({
        hypothesisId: 'H1',
        location: 'scripts/uploadR2.ts:39',
        message: 'upload-start',
        data: { bucketName, baseDir, concurrency, useRemote, fileCount: files.length },
    });
    // #endregion
    await ensureR2Credentials();
    // #region agent log
    await log({
        hypothesisId: 'H1',
        location: 'scripts/uploadR2.ts:94',
        message: 'debug-config',
        data: {
            bucketName,
            baseDir,
            concurrency,
            useRemote,
            skipExisting,
            listPrefix,
            hasEndpoint: Boolean(r2Endpoint),
            hasAccessKey: Boolean(accessKeyId),
            hasSecretKey: Boolean(secretAccessKey),
            hasCfToken: Boolean(cfApiToken),
            hasAccountId: Boolean(accountId),
        },
    });
    // #endregion

    let fileCursor = 0;

    const { keys: existingObjectKeys, reason: existingKeysReason } = await fetchExistingKeys(bucketName);
    console.log(
        `[uploadR2] Existing keys loaded: ${existingObjectKeys.size}${existingKeysReason ? ` (skip list: ${existingKeysReason})` : ''}`,
    );
    console.log('[uploadR2] Sanity check');
    console.log(`  bucket: ${bucketName}`);
    console.log(`  baseDir: ${baseDir}`);
    console.log(`  useRemote: ${useRemote}`);
    console.log(`  concurrency: ${concurrency}`);
    console.log(`  listPrefix: ${listPrefix || '(none)'}`);
    console.log(`  endpoint: ${r2Endpoint || '(missing)'}`);
    console.log(`  accountId: ${accountId || '(missing)'}`);
    console.log(`  hasAccessKey: ${Boolean(accessKeyId)}`);
    console.log(`  hasSecretKey: ${Boolean(secretAccessKey)}`);
    console.log(`  skipExisting: ${skipExisting}`);
    console.log(`  existingKeys: ${existingObjectKeys.size}`);
    if (existingKeysReason) {
        console.log(`  skipListReason: ${existingKeysReason}`);
    }
    if (dryRun) {
        console.log('[uploadR2] Dry run enabled. Exiting before upload.');
        return;
    }
    if (requireConfirm && process.env.R2_CONFIRM !== '1') {
        console.error('[uploadR2] Aborting: set R2_CONFIRM=1 after verifying sanity check output.');
        process.exit(1);
    }
    // #region agent log
    await log({
        hypothesisId: 'H2',
        location: 'scripts/uploadR2.ts:129',
        message: 'debug-existing-keys',
        data: {
            skipExisting,
            listPrefix,
            existingCount: existingObjectKeys.size,
            skipReason: existingKeysReason ?? null,
        },
    });
    // #endregion

    const logProgress = () => {
        const completed = successes + failures + skipped;
        if (completed <= lastLogged) {
            return;
        }
        if (completed !== files.length && completed - lastLogged < progressEvery) {
            return;
        }
        lastLogged = completed;
        const remaining = files.length - completed;
        console.log(
            `[uploadR2] ${completed}/${files.length} processed (${remaining} remaining, ${successes} uploaded, ${skipped} skipped, ${failures} failed)`,
        );
    };

    let inFlight = 0;
    const runOne = async () => {
        while (fileCursor < files.length) {
            const filePath = files[fileCursor++];
            const key = relative(baseDir, filePath).replace(/\\/g, '/');
            if (skipExisting && existingObjectKeys.has(key)) {
                skipped += 1;
                console.log(`[uploadR2] Skipping existing ${key}`);
                logProgress();
                continue;
            }
            inFlight += 1;
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
            let attempt = 0;
            let succeeded = false;
            while (!succeeded) {
                attempt += 1;
                const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
                const stdoutText = await new Response(proc.stdout).text();
                const stderrText = await new Response(proc.stderr).text();
                const code = await proc.exited;
                const is429 = /\b429\b|TooManyRequests/i.test(stderrText);
                if (code === 0) {
                    if (wranglerVerbose) {
                        if (stdoutText) {
                            process.stdout.write(stdoutText);
                        }
                        if (stderrText) {
                            process.stderr.write(stderrText);
                        }
                    }
                    successes += 1;
                    succeeded = true;
                    break;
                }
                if (stdoutText) {
                    process.stdout.write(stdoutText);
                }
                if (stderrText) {
                    process.stderr.write(stderrText);
                }
                if (is429 && attempt <= retry429) {
                    console.warn(`[uploadR2] 429 detected for ${key} (attempt ${attempt}/${retry429}). Retrying.`);
                    continue;
                }
                failures += 1;
                // #region agent log
                await log({
                    hypothesisId: 'H3',
                    location: 'scripts/uploadR2.ts:77',
                    message: 'upload-error',
                    data: { key, useRemote },
                });
                // #endregion
                // #region agent log
                await log({
                    hypothesisId: 'H3',
                    location: 'scripts/uploadR2.ts:157',
                    message: 'debug-wrangler-exit',
                    data: {
                        key,
                        exitCode: code,
                        useRemote,
                        inFlight,
                        args,
                        attempt,
                        is429,
                    },
                });
                // #endregion
                succeeded = true;
            }
            inFlight -= 1;
            logProgress();
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
