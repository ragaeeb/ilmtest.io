import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { updateWranglerBucketBindings, writeEnvFile } from './cloudflareGuided';

const tempRoots: string[] = [];

afterEach(async () => {
    await Promise.all(
        tempRoots.splice(0).map(async (tempRoot) => {
            await rm(tempRoot, { recursive: true, force: true });
        }),
    );
});

describe('cloudflareGuided helpers', () => {
    it('writes and updates env assignments safely', async () => {
        const tempRoot = await mkdtemp(join(tmpdir(), 'ilmtest-cloudflare-guided-'));
        tempRoots.push(tempRoot);

        const envPath = join(tempRoot, '.env');
        await writeFile(envPath, 'R2_BUCKET="legacy-bucket"\nEXISTING_VALUE="keep-me"\n', 'utf8');

        await writeEnvFile(envPath, {
            R2_BUCKET: 'ilmtest-datasets',
            CF_ACCOUNT_ID: '1234567890abcdef1234567890abcdef',
            R2_ACCESS_KEY_ID: 'abc123',
        });

        const result = await readFile(envPath, 'utf8');
        expect(result).toContain('R2_BUCKET="ilmtest-datasets"');
        expect(result).toContain('CF_ACCOUNT_ID="1234567890abcdef1234567890abcdef"');
        expect(result).toContain('R2_ACCESS_KEY_ID="abc123"');
        expect(result).toContain('EXISTING_VALUE="keep-me"');
    });

    it('updates the EXCERPT_BUCKET binding in wrangler.jsonc', async () => {
        const tempRoot = await mkdtemp(join(tmpdir(), 'ilmtest-cloudflare-guided-'));
        tempRoots.push(tempRoot);

        const wranglerPath = join(tempRoot, 'wrangler.jsonc');
        await writeFile(
            wranglerPath,
            `{
                // top-level binding should be updated too
                "r2_buckets": [
                    { "binding": "EXCERPT_BUCKET", "bucket_name": "old-bucket", "preview_bucket_name": "old-bucket" }
                ],
                "env": {
                    "preview": {
                        "r2_buckets": [
                            {
                                "binding": "EXCERPT_BUCKET",
                                "bucket_name": "old-bucket",
                                "preview_bucket_name": "old-bucket"
                            }
                        ]
                    }
                }
            }`,
            'utf8',
        );

        await updateWranglerBucketBindings(wranglerPath, 'ilmtest-datasets');

        const result = parse(await readFile(wranglerPath, 'utf8')) as {
            r2_buckets: Array<{ bucket_name: string; preview_bucket_name: string }>;
            env: { preview: { r2_buckets: Array<{ bucket_name: string; preview_bucket_name: string }> } };
        };

        expect(result.r2_buckets[0]?.bucket_name).toBe('ilmtest-datasets');
        expect(result.r2_buckets[0]?.preview_bucket_name).toBe('ilmtest-datasets');
        expect(result.env.preview.r2_buckets[0]?.bucket_name).toBe('ilmtest-datasets');
        expect(result.env.preview.r2_buckets[0]?.preview_bucket_name).toBe('ilmtest-datasets');
    });
});
