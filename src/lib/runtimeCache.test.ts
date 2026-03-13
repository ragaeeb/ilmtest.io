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

        const expectFailure = async () => {
            try {
                await cache.getOrLoad('key', 1000, loader);
                throw new Error('Expected loader to fail');
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toBe('fail');
            }
        };

        await expectFailure();
        await expectFailure();
        expect(calls).toBe(2);
    });

    it('keeps a newer cached value when a stale loader fails later', async () => {
        let now = 0;
        const cache = new RuntimeCache(() => now);
        const staleLoadControl: {
            reject?: (error: Error) => void;
        } = {};
        let freshCalls = 0;

        const staleLoad = cache.getOrLoad(
            'key',
            1000,
            () =>
                new Promise<string>((_resolve, reject) => {
                    staleLoadControl.reject = (error: Error) => reject(error);
                }),
        );

        now = 1500;
        const freshValue = await cache.getOrLoad('key', 1000, async () => {
            freshCalls += 1;
            return 'fresh';
        });

        expect(freshValue).toBe('fresh');

        const rejectStaleLoadFn = staleLoadControl.reject;
        if (!rejectStaleLoadFn) {
            throw new Error('Expected stale loader reject handle');
        }
        rejectStaleLoadFn(new Error('stale failure'));
        try {
            await staleLoad;
            throw new Error('Expected stale loader to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toBe('stale failure');
        }

        expect(await cache.getOrLoad('key', 1000, async () => 'unexpected')).toBe('fresh');
        expect(freshCalls).toBe(1);
    });
});
