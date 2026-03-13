type CacheEntry<T> = {
    expiresAt: number;
    value: Promise<T>;
};

export const POINTER_CACHE_TTL_MS = 60_000;
export const MANIFEST_CACHE_TTL_MS = 60_000;
export const ARTIFACT_CACHE_TTL_MS = 300_000;

export const buildRuntimeCacheKey = (...parts: Array<string | number>) => parts.join(':');

export class RuntimeCache {
    #entries = new Map<string, CacheEntry<unknown>>();
    #now: () => number;

    constructor(now = () => Date.now()) {
        this.#now = now;
    }

    clear() {
        this.#entries.clear();
    }

    delete(key: string) {
        this.#entries.delete(key);
    }

    hasFresh(key: string) {
        const current = this.#entries.get(key);
        return Boolean(current && current.expiresAt > this.#now());
    }

    async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>) {
        const current = this.#entries.get(key) as CacheEntry<T> | undefined;
        if (current && current.expiresAt > this.#now()) {
            return current.value;
        }

        const value = loader();
        this.#entries.set(key, {
            value,
            expiresAt: this.#now() + ttlMs,
        });

        try {
            return await value;
        } catch (error) {
            const latest = this.#entries.get(key) as CacheEntry<T> | undefined;
            if (latest?.value === value) {
                this.#entries.delete(key);
            }
            throw error;
        }
    }
}

export const runtimeCache = new RuntimeCache();
