import { assertDatasetManifest, type DatasetManifest } from './datasetManifest';
import { assertDatasetPointer, type DatasetChannel, type DatasetPointer, getDatasetPointerKey } from './datasetPointer';
import { buildRuntimeCacheKey, MANIFEST_CACHE_TTL_MS, POINTER_CACHE_TTL_MS, type RuntimeCache } from './runtimeCache';

export type BucketJsonReader = <T>(key: string) => Promise<T>;

export const resolveDatasetPointer = async (
    channel: DatasetChannel,
    readJson: BucketJsonReader,
    cache: RuntimeCache,
): Promise<DatasetPointer> => {
    return cache.getOrLoad(buildRuntimeCacheKey('pointer', channel), POINTER_CACHE_TTL_MS, async () =>
        assertDatasetPointer(await readJson<DatasetPointer>(getDatasetPointerKey(channel))),
    );
};

export const resolveDatasetManifest = async (
    manifestKey: string,
    readJson: BucketJsonReader,
    cache: RuntimeCache,
): Promise<DatasetManifest> => {
    return cache.getOrLoad(buildRuntimeCacheKey('manifest', manifestKey), MANIFEST_CACHE_TTL_MS, async () =>
        assertDatasetManifest(await readJson<DatasetManifest>(manifestKey)),
    );
};
