import { env } from 'cloudflare:workers';
import type { Entity, Excerpt } from '@/types/excerpts';
import type { DatasetManifest } from './datasetManifest';
import type { DatasetChannel } from './datasetPointer';
import { fetchExcerptChunk } from './excerptChunks';
import {
    assertCollectionRuntimeShard,
    assertRuntimeCollectionSummaryArray,
    assertRuntimeRouteBootstrap,
    type CollectionRuntimeShard,
    type ExcerptLookupEntry,
    type RuntimeCollectionSummary,
    type SectionSummary,
} from './runtimeArtifacts';
import { ARTIFACT_CACHE_TTL_MS, buildRuntimeCacheKey, runtimeCache } from './runtimeCache';
import { resolveDatasetManifest, resolveDatasetPointer } from './runtimeLoader';

type ModuleMap<T> = Record<string, T>;

type BucketObject = {
    text(): Promise<string>;
};

type ExcerptBucket = {
    get(key: string): Promise<BucketObject | null>;
};

type RuntimeContext = {
    channel: DatasetChannel;
    datasetVersion: string;
    manifest: DatasetManifest | null;
};

type SectionPageData = {
    collection: RuntimeCollectionSummary;
    shard: CollectionRuntimeShard;
    sectionSummary: SectionSummary;
    excerpts: Excerpt[];
};

type ExcerptPaginationItem = {
    id: string;
    href: string;
    preview: string;
};

export type ExcerptPageData = SectionPageData & {
    excerpt: Excerpt;
    translators: Array<{ id: number; name: string }>;
    previousExcerpt: ExcerptPaginationItem | null;
    nextExcerpt: ExcerptPaginationItem | null;
    sectionExcerptList: string[];
};

const getFirstModule = <T>(modules: ModuleMap<T>, fallback: T): T => {
    const values = Object.values(modules);
    return (values.length ? values[0] : fallback) as T;
};

const routeBootstrapModules = import.meta.glob('../data/runtime-bootstrap.json', {
    eager: true,
    import: 'default',
}) as ModuleMap<unknown>;
const collectionModules = import.meta.glob('../data/collections.json', {
    eager: true,
    import: 'default',
}) as ModuleMap<unknown>;
const translatorModules = import.meta.glob('../data/translators.json', {
    eager: true,
    import: 'default',
}) as ModuleMap<unknown>;
const localCollectionShardModules = import.meta.env.DEV
    ? (import.meta.glob('../../tmp/runtime-artifacts/collections/*.json', {
          eager: true,
          import: 'default',
      }) as ModuleMap<unknown>)
    : {};

const LOCAL_COLLECTIONS_PATH = new URL('../data/collections.json', import.meta.url).pathname;
const LOCAL_TRANSLATORS_PATH = new URL('../data/translators.json', import.meta.url).pathname;
const LOCAL_COLLECTION_SHARDS_DIR = new URL('../../tmp/runtime-artifacts/collections/', import.meta.url).pathname;

const getExcerptBucket = (): ExcerptBucket | undefined => env.EXCERPT_BUCKET as ExcerptBucket | undefined;

const isProductionHost = (hostname: string) => hostname === 'ilmtest.io' || hostname === 'www.ilmtest.io';

const readLocalJson = async <T>(filePath: string) => {
    if (typeof Bun === 'undefined') {
        throw new Error(`Local runtime artifact mode is unavailable without Bun: ${filePath}`);
    }

    return (await Bun.file(filePath).json()) as T;
};

const readBucketJson = async <T>(key: string) => {
    const bucket = getExcerptBucket();
    if (!bucket) {
        throw new Error(`Missing EXCERPT_BUCKET binding for runtime artifact: ${key}`);
    }

    const object = await bucket.get(key);
    if (!object) {
        throw new Error(`Missing runtime artifact in R2: ${key}`);
    }

    return JSON.parse(await object.text()) as T;
};

const loadBundledRouteBootstrap = () =>
    assertRuntimeRouteBootstrap(
        getFirstModule(routeBootstrapModules, {
            artifactSchemaVersion: 1,
            generatedAt: new Date(0).toISOString(),
            collectionsBySlug: {},
        }),
    );

const loadBundledCollections = () => assertRuntimeCollectionSummaryArray(getFirstModule(collectionModules, []));

const loadBundledTranslators = () => getFirstModule(translatorModules, []) as Array<{ id: number; name: string }>;

const loadBundledCollectionShard = (collectionId: string) => {
    const match = Object.entries(localCollectionShardModules).find(([path]) => path.endsWith(`/${collectionId}.json`));
    if (!match) {
        return null;
    }

    return assertCollectionRuntimeShard(match[1]);
};

const isLocalRuntimeMode = () => import.meta.env.DEV || !getExcerptBucket();

export const resolveRuntimeChannel = (requestUrl?: string): DatasetChannel => {
    if (import.meta.env.DEV) {
        return 'preview';
    }

    if (!requestUrl) {
        return 'prod';
    }

    try {
        const url = new URL(requestUrl, 'https://ilmtest.io');
        return isProductionHost(url.hostname) ? 'prod' : 'preview';
    } catch {
        return 'prod';
    }
};

const loadRuntimeContext = async (requestUrl?: string): Promise<RuntimeContext> => {
    const channel = resolveRuntimeChannel(requestUrl);
    if (isLocalRuntimeMode()) {
        return {
            channel,
            datasetVersion: 'local',
            manifest: null,
        };
    }

    const pointer = await resolveDatasetPointer(channel, readBucketJson, runtimeCache);
    const manifest = await resolveDatasetManifest(pointer.manifestKey, readBucketJson, runtimeCache);

    return {
        channel,
        datasetVersion: manifest.datasetVersion,
        manifest,
    };
};

const loadCollectionsArtifact = async (requestUrl?: string) => {
    const context = await loadRuntimeContext(requestUrl);

    if (!context.manifest) {
        if (import.meta.env.DEV) {
            return loadBundledCollections();
        }

        return assertRuntimeCollectionSummaryArray(
            await readLocalJson<RuntimeCollectionSummary[]>(LOCAL_COLLECTIONS_PATH),
        );
    }

    return runtimeCache.getOrLoad(
        buildRuntimeCacheKey('artifact', context.datasetVersion, 'collections'),
        ARTIFACT_CACHE_TTL_MS,
        async () =>
            assertRuntimeCollectionSummaryArray(
                await readBucketJson<RuntimeCollectionSummary[]>(
                    context.manifest.runtimeArtifactSet.bootstrap.collections.key,
                ),
            ),
    );
};

export const loadTranslatorsData = async (requestUrl?: string) => {
    const context = await loadRuntimeContext(requestUrl);

    if (!context.manifest) {
        if (import.meta.env.DEV) {
            return loadBundledTranslators();
        }

        return (await readLocalJson<Array<{ id: number; name: string }>>(LOCAL_TRANSLATORS_PATH)) ?? [];
    }

    return runtimeCache.getOrLoad(
        buildRuntimeCacheKey('artifact', context.datasetVersion, 'translators'),
        ARTIFACT_CACHE_TTL_MS,
        async () =>
            await readBucketJson<Array<{ id: number; name: string }>>(
                context.manifest.runtimeArtifactSet.bootstrap.translators.key,
            ),
    );
};

export const loadCollectionsData = async (requestUrl?: string) => {
    return loadCollectionsArtifact(requestUrl);
};

export const resolveCollectionBySlug = async (slug: string, requestUrl?: string) => {
    const collectionId = loadBundledRouteBootstrap().collectionsBySlug[slug]?.id;
    if (!collectionId) {
        return null;
    }

    const collections = await loadCollectionsArtifact(requestUrl);
    return collections.find((collection) => collection.id === collectionId) ?? null;
};

export const loadCollectionShard = async (collectionId: string, requestUrl?: string) => {
    const context = await loadRuntimeContext(requestUrl);

    if (!context.manifest) {
        if (import.meta.env.DEV) {
            const shard = loadBundledCollectionShard(collectionId);
            if (!shard) {
                throw new Error(`Missing local runtime shard for collection ${collectionId}`);
            }

            return shard;
        }

        return assertCollectionRuntimeShard(
            await readLocalJson<CollectionRuntimeShard>(`${LOCAL_COLLECTION_SHARDS_DIR}${collectionId}.json`),
        );
    }

    const descriptor = context.manifest.runtimeArtifactSet.runtime.collectionShards[collectionId];
    if (!descriptor) {
        throw new Error(`Missing runtime shard descriptor for collection ${collectionId}`);
    }

    return runtimeCache.getOrLoad(
        buildRuntimeCacheKey('artifact', context.datasetVersion, 'collection', collectionId),
        ARTIFACT_CACHE_TTL_MS,
        async () => assertCollectionRuntimeShard(await readBucketJson<CollectionRuntimeShard>(descriptor.key)),
    );
};

export const loadCollectionPageData = async (slug: string, page: number, requestUrl?: string) => {
    const collection = await resolveCollectionBySlug(slug, requestUrl);
    if (!collection) {
        return null;
    }

    const shard = await loadCollectionShard(collection.id, requestUrl);
    const pageSize = 100;
    const totalPages = Math.max(1, Math.ceil(shard.sectionOrder.length / pageSize));
    const currentPage = Math.min(Math.max(1, Math.floor(page)), totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const sectionIds = shard.sectionOrder.slice(startIndex, startIndex + pageSize);

    return {
        collection,
        sectionItems: sectionIds
            .map((sectionId) => shard.sectionSummaries[sectionId])
            .filter((summary): summary is SectionSummary => Boolean(summary)),
        totalSections: shard.sectionOrder.length,
        currentPage,
        totalPages,
    };
};

const readSectionChunks = async (
    shard: CollectionRuntimeShard,
    sectionId: string,
    requestUrl?: string,
    datasetVersion?: string,
) => {
    const descriptors = shard.sectionDescriptors[sectionId] ?? [];
    if (descriptors.length === 0) {
        return [];
    }
    if (descriptors.length > 8) {
        throw new Error(
            `Section ${sectionId} exceeds the runtime chunk fan-out cap with ${descriptors.length} descriptors`,
        );
    }

    const chunks = await Promise.all(
        descriptors.map((descriptor) => fetchExcerptChunk(descriptor.chunkKey, requestUrl, datasetVersion)),
    );

    return descriptors.flatMap((descriptor, index) => {
        const chunk = chunks[index];
        if (!chunk) {
            throw new Error(`Missing chunk payload for ${descriptor.chunkKey}`);
        }
        return chunk.excerpts.slice(descriptor.start, descriptor.end + 1);
    });
};

export const loadSectionPageData = async (
    slug: string,
    sectionId: string,
    requestUrl?: string,
): Promise<SectionPageData | null> => {
    const collection = await resolveCollectionBySlug(slug, requestUrl);
    if (!collection) {
        return null;
    }

    const shard = await loadCollectionShard(collection.id, requestUrl);
    const sectionSummary = shard.sectionSummaries[sectionId];
    if (!sectionSummary) {
        return null;
    }

    const { datasetVersion } = await loadRuntimeContext(requestUrl);
    const excerpts = await readSectionChunks(
        shard,
        sectionId,
        requestUrl,
        datasetVersion === 'local' ? undefined : datasetVersion,
    );

    return {
        collection,
        shard,
        sectionSummary,
        excerpts: excerpts.filter((excerpt) => excerpt.id !== sectionId).sort((left, right) => left.from - right.from),
    };
};

const buildExcerptPagerItem = (
    slug: string,
    sectionId: string,
    excerptId: string | null,
    excerptLookup: Record<string, ExcerptLookupEntry>,
): ExcerptPaginationItem | null => {
    if (!excerptId) {
        return null;
    }

    const target = excerptLookup[excerptId];
    if (!target) {
        return null;
    }

    return {
        id: excerptId,
        href: `/browse/${slug}/${sectionId}/e/${excerptId}`,
        preview: target.preview,
    };
};

export const loadExcerptPageData = async (
    slug: string,
    sectionId: string,
    excerptId: string,
    requestUrl?: string,
): Promise<ExcerptPageData | null> => {
    const sectionData = await loadSectionPageData(slug, sectionId, requestUrl);
    if (!sectionData) {
        return null;
    }

    const sectionExcerptList = sectionData.shard.sectionExcerpts[sectionId] ?? [];
    if (!sectionExcerptList.includes(excerptId)) {
        return null;
    }

    const lookup = sectionData.shard.excerptLookup[excerptId];
    if (!lookup) {
        return null;
    }

    const { datasetVersion } = await loadRuntimeContext(requestUrl);
    const chunk = await fetchExcerptChunk(
        lookup.chunkKey,
        requestUrl,
        datasetVersion === 'local' ? undefined : datasetVersion,
    );
    const excerpt = chunk?.excerpts.find((candidate) => candidate.id === excerptId) ?? null;
    if (!excerpt) {
        return null;
    }

    const currentIndex = sectionExcerptList.indexOf(excerptId);
    const previousExcerptId = currentIndex > 0 ? sectionExcerptList[currentIndex - 1] : null;
    const nextExcerptId =
        currentIndex >= 0 && currentIndex < sectionExcerptList.length - 1 ? sectionExcerptList[currentIndex + 1] : null;

    return {
        ...sectionData,
        excerpt,
        translators: await loadTranslatorsData(requestUrl),
        previousExcerpt: buildExcerptPagerItem(slug, sectionId, previousExcerptId, sectionData.shard.excerptLookup),
        nextExcerpt: buildExcerptPagerItem(slug, sectionId, nextExcerptId, sectionData.shard.excerptLookup),
        sectionExcerptList,
    };
};

const buildEntityCollectionIndex = (collections: RuntimeCollectionSummary[]) => {
    const entities = new Map<
        string,
        {
            entity: Entity;
            collections: RuntimeCollectionSummary[];
        }
    >();

    for (const collection of collections) {
        for (const author of collection.authors) {
            const current = entities.get(author.id);
            if (current) {
                current.collections.push(collection);
                continue;
            }

            entities.set(author.id, {
                entity: author,
                collections: [collection],
            });
        }
    }

    return entities;
};

export const loadProfileEntityIds = async (requestUrl?: string) => {
    return [...buildEntityCollectionIndex(await loadCollectionsArtifact(requestUrl)).keys()];
};

export const loadProfileData = async (entityId: string, requestUrl?: string) => {
    return buildEntityCollectionIndex(await loadCollectionsArtifact(requestUrl)).get(entityId) ?? null;
};

export const loadSitemapCollectionData = async (requestUrl?: string) => {
    const collections = await loadCollectionsArtifact(requestUrl);

    return Promise.all(
        collections.map(async (collection) => ({
            collection,
            sectionIds: (await loadCollectionShard(collection.id, requestUrl)).sectionOrder,
        })),
    );
};
