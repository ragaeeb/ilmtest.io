import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';

type WranglerConfig = {
    name?: string;
    preview_urls?: boolean;
    vars?: Record<string, string>;
    r2_buckets?: Array<{ binding: string; bucket_name: string; preview_bucket_name?: string }>;
    env?: Record<
        string,
        {
            name?: string;
            preview_urls?: boolean;
            vars?: Record<string, string>;
            r2_buckets?: Array<{ binding: string; bucket_name: string; preview_bucket_name?: string }>;
        }
    >;
};

describe('workers deployment config', () => {
    it('uses wrangler deploy as the canonical path with a preview environment', async () => {
        const packageJson = (await Bun.file(join(process.cwd(), 'package.json')).json()) as {
            scripts?: Record<string, string>;
        };
        const wrangler = (await Bun.file(join(process.cwd(), 'wrangler.jsonc')).json()) as WranglerConfig;
        const deployScript = packageJson.scripts?.deploy ?? '';
        const deployProdScript = packageJson.scripts?.['deploy:prod'] ?? '';
        const deployPreviewScript = packageJson.scripts?.['deploy:preview'] ?? '';
        const deployCheckScript = packageJson.scripts?.['deploy-check'] ?? '';
        const deployPreviewCheckScript = packageJson.scripts?.['deploy-check:preview'] ?? '';

        expect(deployScript).toContain('bun run deploy:prod');
        expect(deployProdScript).toContain('prepareWorkerDeploy.ts prod');
        expect(deployProdScript).toContain('dist/functions/wrangler.prod.json');
        expect(deployPreviewScript).toContain('prepareWorkerDeploy.ts preview');
        expect(deployPreviewScript).toContain('dist/functions/wrangler.preview.json');
        expect(deployCheckScript).toContain('--dry-run');
        expect(deployCheckScript).toContain('prepareWorkerDeploy.ts prod');
        expect(deployPreviewCheckScript).toContain('prepareWorkerDeploy.ts preview');
        expect(deployScript).not.toContain('pages deploy');

        expect(wrangler.name).toBe('ilmtest-io');
        expect(wrangler.preview_urls).toBe(true);
        expect(wrangler.vars?.ILMTEST_RUNTIME_CHANNEL).toBe('prod');
        expect(wrangler.vars?.PUBLIC_ROBOTS_POLICY).toBe('allow');
        expect(wrangler.env?.preview?.name).toBe('ilmtest-io-preview');
        expect(wrangler.env?.preview?.preview_urls).toBe(true);
        expect(wrangler.env?.preview?.vars?.ILMTEST_RUNTIME_CHANNEL).toBe('preview');
        expect(wrangler.env?.preview?.vars?.PUBLIC_ROBOTS_POLICY).toBe('disallow');
        expect(wrangler.env?.preview?.vars?.PUBLIC_AI_CRAWL_POLICY).toBe('disallow');
        expect(wrangler.r2_buckets?.[0]?.binding).toBe('EXCERPT_BUCKET');
        expect(wrangler.env?.preview?.r2_buckets?.[0]?.binding).toBe('EXCERPT_BUCKET');
    });
});
