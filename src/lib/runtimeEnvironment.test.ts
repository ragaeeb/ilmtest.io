import { describe, expect, it } from 'bun:test';
import {
    isProductionHost,
    normalizeSiteUrl,
    resolveDatasetVersionOverride,
    resolveDefaultRobotsPolicy,
    resolvePublicOrigin,
    resolveRuntimeChannel,
} from './runtimeEnvironment';

describe('runtimeEnvironment', () => {
    it('resolves the runtime channel from explicit config before host heuristics', () => {
        expect(
            resolveRuntimeChannel({
                requestUrl: 'https://preview.ilmtest.workers.dev/browse',
                configuredChannel: 'prod',
            }),
        ).toBe('prod');
        expect(
            resolveRuntimeChannel({
                requestUrl: 'https://ilmtest.io/browse',
                configuredChannel: 'preview',
            }),
        ).toBe('preview');
    });

    it('falls back to preview in local dev and to host-based detection otherwise', () => {
        expect(resolveRuntimeChannel({ isDev: true })).toBe('preview');
        expect(resolveRuntimeChannel({ isDev: true, configuredChannel: 'prod' })).toBe('preview');
        expect(resolveRuntimeChannel({ requestUrl: 'https://ilmtest.io/browse' })).toBe('prod');
        expect(resolveRuntimeChannel({ requestUrl: 'https://www.ilmtest.io/browse' })).toBe('prod');
        expect(resolveRuntimeChannel({ requestUrl: 'https://ilmtest-preview.workers.dev/browse' })).toBe('preview');
        expect(resolveRuntimeChannel({ requestHost: 'ilmtest.io' })).toBe('prod');
        expect(resolveRuntimeChannel({ requestHost: '127.0.0.1:4321' })).toBe('preview');
    });

    it('only honors dataset-version overrides outside production', () => {
        expect(
            resolveDatasetVersionOverride({
                channel: 'prod',
                datasetVersionOverride: '2026-03-12T18-42-10Z-abc1234',
            }),
        ).toBeUndefined();
        expect(
            resolveDatasetVersionOverride({
                channel: 'preview',
                datasetVersionOverride: '2026-03-12T18-42-10Z-abc1234',
            }),
        ).toBe('2026-03-12T18-42-10Z-abc1234');
        expect(
            resolveDatasetVersionOverride({
                channel: 'prod',
                datasetVersionOverride: '2026-03-12T18-42-10Z-abc1234',
                isDev: true,
            }),
        ).toBe('2026-03-12T18-42-10Z-abc1234');
    });

    it('uses the request origin for preview/public preview routes', () => {
        expect(
            resolvePublicOrigin({
                requestUrl: 'https://ilmtest-preview.workers.dev/sitemap.xml',
                configuredSite: 'https://ilmtest.io',
                channel: 'preview',
            }),
        ).toBe('https://ilmtest-preview.workers.dev');
        expect(
            resolvePublicOrigin({
                requestUrl: 'https://ilmtest.io/sitemap.xml',
                configuredSite: 'https://ilmtest.io',
                channel: 'prod',
            }),
        ).toBe('https://ilmtest.io');
    });

    it('normalizes site URLs and default robots policy', () => {
        expect(normalizeSiteUrl()).toBe('https://ilmtest.io');
        expect(normalizeSiteUrl('ilmtest.io')).toBe('https://ilmtest.io');
        expect(isProductionHost('ilmtest.io')).toBe(true);
        expect(isProductionHost('preview.ilmtest.workers.dev')).toBe(false);
        expect(resolveDefaultRobotsPolicy('prod')).toBe('allow');
        expect(resolveDefaultRobotsPolicy('preview')).toBe('disallow');
    });
});
