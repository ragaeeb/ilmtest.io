import type { Entity, Excerpt } from '@/types/excerpts';
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
import { loadRuntimeContext, type RuntimeContext, readBucketJson } from './runtimeContext';
import { getErrorMessage, RuntimeDataError } from './runtimeErrors';
import { logRuntimeSignal } from './runtimeSignals';

type ModuleMap<T> = Record<string, T>;

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

const resolveModuleFilePath = (relativePath: string) => {
    const pathname = decodeURIComponent(new URL(relativePath, import.meta.url).pathname);
    return pathname.replace(/^\/([A-Za-z]:\/)/, '$1');
};

const LOCAL_COLLECTIONS_PATH = resolveModuleFilePath('../data/collections.json');
const LOCAL_TRANSLATORS_PATH = resolveModuleFilePath('../data/translators.json');

const readLocalJson = async <T>(filePath: string) => {
    if (typeof Bun === 'undefined') {
        throw new RuntimeDataError(
            'local-artifact-missing',
            `Local runtime artifact mode is unavailable without Bun: ${filePath}`,
        );
    }

    return (await Bun.file(filePath).json()) as T;
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

const getLocalCollectionShardPath = (collectionId: string) =>
    resolveModuleFilePath(`../../tmp/runtime-artifacts/collections/${collectionId}.json`);

const loadCollectionsArtifactFromContext = async (context: RuntimeContext) => {
    const startedAt = Date.now();
    const cacheKey = buildRuntimeCacheKey('artifact', context.datasetVersion, 'collections');
    const manifest = context.manifest;
    const cacheStatus = !manifest ? 'local' : runtimeCache.hasFresh(cacheKey) ? 'hit' : 'miss';

    try {
        const collections = !manifest
            ? import.meta.env.DEV
                ? loadBundledCollections()
                : assertRuntimeCollectionSummaryArray(
                      await readLocalJson<RuntimeCollectionSummary[]>(LOCAL_COLLECTIONS_PATH),
                  )
            : await runtimeCache.getOrLoad(cacheKey, ARTIFACT_CACHE_TTL_MS, async () =>
                  assertRuntimeCollectionSummaryArray(
                      await readBucketJson<RuntimeCollectionSummary[]>(
                          manifest.runtimeArtifactSet.bootstrap.collections.key,
                          {
                              datasetVersion: context.datasetVersion,
                              manifestKey: context.manifestKey,
                          },
                      ),
                  ),
              );

        logRuntimeSignal({
            routeType: 'collections-artifact',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            cacheStatus,
            r2Operation: context.manifest && cacheStatus === 'miss' ? 'get' : undefined,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return collections;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'collections-artifact',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            cacheStatus,
            r2Operation: context.manifest ? 'get' : undefined,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
};

const loadTranslatorsFromContext = async (context: RuntimeContext) => {
    const startedAt = Date.now();
    const cacheKey = buildRuntimeCacheKey('artifact', context.datasetVersion, 'translators');
    const manifest = context.manifest;
    const cacheStatus = !manifest ? 'local' : runtimeCache.hasFresh(cacheKey) ? 'hit' : 'miss';

    try {
        const translators = !manifest
            ? import.meta.env.DEV
                ? loadBundledTranslators()
                : ((await readLocalJson<Array<{ id: number; name: string }>>(LOCAL_TRANSLATORS_PATH)) ?? [])
            : await runtimeCache.getOrLoad(
                  cacheKey,
                  ARTIFACT_CACHE_TTL_MS,
                  async () =>
                      await readBucketJson<Array<{ id: number; name: string }>>(
                          manifest.runtimeArtifactSet.bootstrap.translators.key,
                          {
                              datasetVersion: context.datasetVersion,
                              manifestKey: context.manifestKey,
                          },
                      ),
              );

        logRuntimeSignal({
            routeType: 'translators-artifact',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            cacheStatus,
            r2Operation: context.manifest && cacheStatus === 'miss' ? 'get' : undefined,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return translators;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'translators-artifact',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            cacheStatus,
            r2Operation: context.manifest ? 'get' : undefined,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
};

const resolveCollectionBySlugFromContext = async (slug: string, context: RuntimeContext) => {
    const collectionId = loadBundledRouteBootstrap().collectionsBySlug[slug]?.id;
    if (!collectionId) {
        return null;
    }

    const collections = await loadCollectionsArtifactFromContext(context);
    return collections.find((collection) => collection.id === collectionId) ?? null;
};

const loadCollectionShardFromContext = async (collectionId: string, context: RuntimeContext) => {
    const startedAt = Date.now();
    const cacheKey = buildRuntimeCacheKey('artifact', context.datasetVersion, 'collection', collectionId);
    const manifest = context.manifest;
    const cacheStatus = !manifest ? 'local' : runtimeCache.hasFresh(cacheKey) ? 'hit' : 'miss';

    try {
        const shard = !manifest
            ? import.meta.env.DEV
                ? (() => {
                      const localShard = loadBundledCollectionShard(collectionId);
                      if (!localShard) {
                          throw new RuntimeDataError(
                              'local-artifact-missing',
                              `Missing local runtime shard for collection ${collectionId}`,
                              {
                                  datasetVersion: context.datasetVersion,
                                  manifestKey: context.manifestKey,
                                  artifactKey: getLocalCollectionShardPath(collectionId),
                                  collectionId,
                              },
                          );
                      }
                      return localShard;
                  })()
                : assertCollectionRuntimeShard(
                      await readLocalJson<CollectionRuntimeShard>(getLocalCollectionShardPath(collectionId)),
                  )
            : await runtimeCache.getOrLoad(cacheKey, ARTIFACT_CACHE_TTL_MS, async () => {
                  const descriptor = manifest.runtimeArtifactSet.runtime.collectionShards[collectionId];
                  if (!descriptor) {
                      throw new RuntimeDataError(
                          'artifact-missing',
                          `Missing runtime shard descriptor for collection ${collectionId}`,
                          {
                              datasetVersion: context.datasetVersion,
                              manifestKey: context.manifestKey,
                              collectionId,
                          },
                      );
                  }

                  return assertCollectionRuntimeShard(
                      await readBucketJson<CollectionRuntimeShard>(descriptor.key, {
                          datasetVersion: context.datasetVersion,
                          manifestKey: context.manifestKey,
                          collectionId,
                      }),
                  );
              });

        logRuntimeSignal({
            routeType: 'collection-shard',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            collectionId,
            cacheStatus,
            r2Operation: context.manifest && cacheStatus === 'miss' ? 'get' : undefined,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return shard;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'collection-shard',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            collectionId,
            cacheStatus,
            r2Operation: context.manifest ? 'get' : undefined,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
};

export const loadTranslatorsData = async (requestUrl?: string) => {
    const context = await loadRuntimeContext(requestUrl);
    return loadTranslatorsFromContext(context);
};

export const loadCollectionsData = async (requestUrl?: string) => {
    const startedAt = Date.now();
    let context: RuntimeContext | null = null;

    try {
        context = await loadRuntimeContext(requestUrl);
        const collections = await loadCollectionsArtifactFromContext(context);
        logRuntimeSignal({
            routeType: 'browse-route',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return collections;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'browse-route',
            datasetVersion: context?.datasetVersion,
            manifestKey: context?.manifestKey ?? undefined,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
};

export const resolveCollectionBySlug = async (slug: string, requestUrl?: string) => {
    const context = await loadRuntimeContext(requestUrl);
    return resolveCollectionBySlugFromContext(slug, context);
};

export const loadCollectionShard = async (collectionId: string, requestUrl?: string) => {
    const context = await loadRuntimeContext(requestUrl);
    return loadCollectionShardFromContext(collectionId, context);
};

const loadCollectionPageDataFromContext = async (slug: string, page: number, context: RuntimeContext) => {
    const collection = await resolveCollectionBySlugFromContext(slug, context);
    if (!collection) {
        return null;
    }

    const shard = await loadCollectionShardFromContext(collection.id, context);
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

export const loadCollectionPageData = async (slug: string, page: number, requestUrl?: string) => {
    const startedAt = Date.now();
    let context: RuntimeContext | null = null;
    let collectionId: string | undefined;

    try {
        context = await loadRuntimeContext(requestUrl);
        const pageData = await loadCollectionPageDataFromContext(slug, page, context);
        collectionId = pageData?.collection.id;

        logRuntimeSignal({
            routeType: 'collection-route',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            collectionId,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return pageData;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'collection-route',
            datasetVersion: context?.datasetVersion,
            manifestKey: context?.manifestKey ?? undefined,
            collectionId,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
};

const readSectionChunks = async (
    shard: CollectionRuntimeShard,
    sectionId: string,
    collectionId: string,
    context: RuntimeContext,
    requestUrl?: string,
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

    const datasetVersion = context.datasetVersion === 'local' ? undefined : context.datasetVersion;
    const chunks = await Promise.all(
        descriptors.map((descriptor) => fetchExcerptChunk(descriptor.chunkKey, requestUrl, datasetVersion)),
    );

    return descriptors.flatMap((descriptor, index) => {
        const chunk = chunks[index];
        if (!chunk) {
            throw new RuntimeDataError('chunk-missing', `Missing chunk payload for ${descriptor.chunkKey}`, {
                datasetVersion: context.datasetVersion,
                manifestKey: context.manifestKey,
                chunkKey: descriptor.chunkKey,
                collectionId,
            });
        }
        return chunk.excerpts.slice(descriptor.start, descriptor.end + 1);
    });
};

const loadSectionPageDataFromContext = async (
    slug: string,
    sectionId: string,
    context: RuntimeContext,
    requestUrl?: string,
): Promise<SectionPageData | null> => {
    const collection = await resolveCollectionBySlugFromContext(slug, context);
    if (!collection) {
        return null;
    }

    const shard = await loadCollectionShardFromContext(collection.id, context);
    const sectionSummary = shard.sectionSummaries[sectionId];
    if (!sectionSummary) {
        return null;
    }

    const excerpts = await readSectionChunks(shard, sectionId, collection.id, context, requestUrl);

    return {
        collection,
        shard,
        sectionSummary,
        excerpts: excerpts.filter((excerpt) => excerpt.id !== sectionId).sort((left, right) => left.from - right.from),
    };
};

export const loadSectionPageData = async (
    slug: string,
    sectionId: string,
    requestUrl?: string,
): Promise<SectionPageData | null> => {
    const startedAt = Date.now();
    let context: RuntimeContext | null = null;
    let collectionId: string | undefined;

    try {
        context = await loadRuntimeContext(requestUrl);
        const sectionData = await loadSectionPageDataFromContext(slug, sectionId, context, requestUrl);
        collectionId = sectionData?.collection.id;

        logRuntimeSignal({
            routeType: 'section-route',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            collectionId,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return sectionData;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'section-route',
            datasetVersion: context?.datasetVersion,
            manifestKey: context?.manifestKey ?? undefined,
            collectionId,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
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

const loadExcerptPageDataFromContext = async (
    slug: string,
    sectionId: string,
    excerptId: string,
    context: RuntimeContext,
    requestUrl?: string,
): Promise<ExcerptPageData | null> => {
    const sectionData = await loadSectionPageDataFromContext(slug, sectionId, context, requestUrl);
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

    const chunk = await fetchExcerptChunk(
        lookup.chunkKey,
        requestUrl,
        context.datasetVersion === 'local' ? undefined : context.datasetVersion,
    );
    const excerpt = chunk?.excerpts.find((candidate) => candidate.id === excerptId) ?? null;
    if (!excerpt) {
        throw new RuntimeDataError('chunk-missing', `Missing excerpt payload for ${lookup.chunkKey}`, {
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey,
            chunkKey: lookup.chunkKey,
            collectionId: sectionData.collection.id,
        });
    }

    const currentIndex = sectionExcerptList.indexOf(excerptId);
    const previousExcerptId = currentIndex > 0 ? sectionExcerptList[currentIndex - 1] : null;
    const nextExcerptId =
        currentIndex >= 0 && currentIndex < sectionExcerptList.length - 1 ? sectionExcerptList[currentIndex + 1] : null;

    return {
        ...sectionData,
        excerpt,
        translators: await loadTranslatorsFromContext(context),
        previousExcerpt: buildExcerptPagerItem(slug, sectionId, previousExcerptId, sectionData.shard.excerptLookup),
        nextExcerpt: buildExcerptPagerItem(slug, sectionId, nextExcerptId, sectionData.shard.excerptLookup),
        sectionExcerptList,
    };
};

export const loadExcerptPageData = async (
    slug: string,
    sectionId: string,
    excerptId: string,
    requestUrl?: string,
): Promise<ExcerptPageData | null> => {
    const startedAt = Date.now();
    let context: RuntimeContext | null = null;
    let collectionId: string | undefined;

    try {
        context = await loadRuntimeContext(requestUrl);
        const excerptData = await loadExcerptPageDataFromContext(slug, sectionId, excerptId, context, requestUrl);
        collectionId = excerptData?.collection.id;

        logRuntimeSignal({
            routeType: 'excerpt-route',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            collectionId,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return excerptData;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'excerpt-route',
            datasetVersion: context?.datasetVersion,
            manifestKey: context?.manifestKey ?? undefined,
            collectionId,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
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
    const context = await loadRuntimeContext(requestUrl);
    return [...buildEntityCollectionIndex(await loadCollectionsArtifactFromContext(context)).keys()];
};

const loadProfileDataFromContext = async (entityId: string, context: RuntimeContext) => {
    return buildEntityCollectionIndex(await loadCollectionsArtifactFromContext(context)).get(entityId) ?? null;
};

export const loadProfileData = async (entityId: string, requestUrl?: string) => {
    const startedAt = Date.now();
    let context: RuntimeContext | null = null;

    try {
        context = await loadRuntimeContext(requestUrl);
        const profile = await loadProfileDataFromContext(entityId, context);

        logRuntimeSignal({
            routeType: 'profile-route',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return profile;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'profile-route',
            datasetVersion: context?.datasetVersion,
            manifestKey: context?.manifestKey ?? undefined,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
};

const loadSitemapCollectionDataFromContext = async (context: RuntimeContext) => {
    const collections = await loadCollectionsArtifactFromContext(context);

    return Promise.all(
        collections.map(async (collection) => ({
            collection,
            sectionIds: (await loadCollectionShardFromContext(collection.id, context)).sectionOrder,
        })),
    );
};

export const loadSitemapCollectionData = async (requestUrl?: string) => {
    const startedAt = Date.now();
    let context: RuntimeContext | null = null;

    try {
        context = await loadRuntimeContext(requestUrl);
        const collections = await loadSitemapCollectionDataFromContext(context);

        logRuntimeSignal({
            routeType: 'sitemap-route',
            datasetVersion: context.datasetVersion,
            manifestKey: context.manifestKey ?? undefined,
            durationMs: Date.now() - startedAt,
            status: 'ok',
        });
        return collections;
    } catch (error) {
        logRuntimeSignal({
            routeType: 'sitemap-route',
            datasetVersion: context?.datasetVersion,
            manifestKey: context?.manifestKey ?? undefined,
            durationMs: Date.now() - startedAt,
            status: 'error',
            message: getErrorMessage(error),
        });
        throw error;
    }
};
