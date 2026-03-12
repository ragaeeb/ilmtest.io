import { describe, expect, it } from 'bun:test';
import { buildRuntimeCacheKey, RuntimeCache } from './runtimeCache';

describe('runtimeCache', () => {
    it('builds stable cache keys', () => {
        expect(buildRuntimeCacheKey('manifest', 'v1', 42)).toBe('manifest:v1:42');
    });

    it('reuses cached values until ttl expires', async () => {
        let now = 0;
        const cache = new RuntimeCache(() => now);
        let calls = 0;
        const loader = async () => {
            calls += 1;
            return calls;
        };

        expect(await cache.getOrLoad('key', 1000, loader)).toBe(1);
        expect(await cache.getOrLoad('key', 1000, loader)).toBe(1);
        expect(calls).toBe(1);

        now = 1500;
        expect(await cache.getOrLoad('key', 1000, loader)).toBe(2);
        expect(calls).toBe(2);
    });

    it('evicts entries when loaders fail', async () => {
        const now = 0;
        const cache = new RuntimeCache(() => now);
        let calls = 0;

        const loader = async () => {
            calls += 1;
            throw new Error('fail');
        };

        await expect(cache.getOrLoad('key', 1000, loader)).rejects.toThrow('fail');
        await expect(cache.getOrLoad('key', 1000, loader)).rejects.toThrow('fail');
        expect(calls).toBe(2);
    });
});
