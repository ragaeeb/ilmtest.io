import { describe, expect, it } from 'bun:test';
import { extractPreviewUrl, extractUrls } from './releaseGuided';

describe('releaseGuided helpers', () => {
    it('extracts URLs from wrangler output', () => {
        expect(
            extractUrls(`
                Deployed successfully
                Preview URL: https://ilmtest-io-preview.example.workers.dev
                Dashboard: https://dash.cloudflare.com/example
            `),
        ).toEqual(['https://ilmtest-io-preview.example.workers.dev', 'https://dash.cloudflare.com/example']);
    });

    it('prefers workers.dev preview URLs when present', () => {
        expect(
            extractPreviewUrl(`
                Dashboard: https://dash.cloudflare.com/example
                Preview URL: https://ilmtest-io-preview.example.workers.dev
            `),
        ).toBe('https://ilmtest-io-preview.example.workers.dev');
    });

    it('falls back to the last discovered URL when workers.dev is absent', () => {
        expect(
            extractPreviewUrl(`
                Deploy complete
                https://example.com/preview
            `),
        ).toBe('https://example.com/preview');
    });
});
