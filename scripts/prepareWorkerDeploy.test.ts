import { describe, expect, it } from 'bun:test';
import { buildWorkerDeployConfig } from './prepareWorkerDeploy';

describe('prepareWorkerDeploy', () => {
    it('applies preview overrides to the generated worker config', () => {
        const generated = {
            name: 'ilmtest-io',
            main: 'index.mjs',
            vars: {
                ILMTEST_RUNTIME_CHANNEL: 'prod',
                PUBLIC_ROBOTS_POLICY: 'allow',
            },
            r2_buckets: [{ binding: 'EXCERPT_BUCKET', bucket_name: 'ilmtest-datasets' }],
        };
        const root = {
            name: 'ilmtest-io',
            preview_urls: true,
            vars: {
                ILMTEST_RUNTIME_CHANNEL: 'prod',
                PUBLIC_ROBOTS_POLICY: 'allow',
            },
            r2_buckets: [{ binding: 'EXCERPT_BUCKET', bucket_name: 'ilmtest-datasets' }],
            env: {
                preview: {
                    name: 'ilmtest-io-preview',
                    preview_urls: true,
                    vars: {
                        ILMTEST_RUNTIME_CHANNEL: 'preview',
                        PUBLIC_ROBOTS_POLICY: 'disallow',
                        PUBLIC_AI_CRAWL_POLICY: 'disallow',
                    },
                    r2_buckets: [{ binding: 'EXCERPT_BUCKET', bucket_name: 'ilmtest-datasets' }],
                },
            },
        };

        const previewConfig = buildWorkerDeployConfig(generated, root, 'preview');
        const prodConfig = buildWorkerDeployConfig(generated, root, 'prod');

        expect(previewConfig.name).toBe('ilmtest-io-preview');
        expect(previewConfig.vars?.ILMTEST_RUNTIME_CHANNEL).toBe('preview');
        expect(previewConfig.vars?.PUBLIC_ROBOTS_POLICY).toBe('disallow');
        expect(previewConfig.vars?.PUBLIC_AI_CRAWL_POLICY).toBe('disallow');
        expect(previewConfig.r2_buckets).toEqual([{ binding: 'EXCERPT_BUCKET', bucket_name: 'ilmtest-datasets' }]);
        expect(prodConfig.name).toBe('ilmtest-io');
        expect(prodConfig.vars?.ILMTEST_RUNTIME_CHANNEL).toBe('prod');
        expect(prodConfig.vars?.PUBLIC_ROBOTS_POLICY).toBe('allow');
        expect(prodConfig.r2_buckets).toEqual([{ binding: 'EXCERPT_BUCKET', bucket_name: 'ilmtest-datasets' }]);
    });
});
