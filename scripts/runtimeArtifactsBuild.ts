import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Collection, Excerpt } from '@/types/excerpts';
import { ARTIFACT_SCHEMA_VERSION } from '../src/lib/datasetManifest';
import {
    assertCollectionRuntimeShard,
    assertRuntimeCollectionSummaryArray,
    assertRuntimeRouteBootstrap,
    buildSectionChunkDescriptor,
    type CollectionRuntimeShard,
    type ExcerptLookupEntry,
    type RuntimeCollectionSummary,
    type RuntimeRouteBootstrap,
    type SectionSummary,
} from '../src/lib/runtimeArtifacts';
import type { LookupIndexes } from './indexing';
import { readChunkFromDisk } from './runtimeData';

type BuildRuntimeArtifactsOptions = {
    collections: Collection[];
    indexes: LookupIndexes;
    chunksDir: string;
    generatedAt: string;
    headingMarkersByCollection?: Record<string, Map<string, Excerpt>>;
};

export type BuiltRuntimeArtifacts = {
    collections: RuntimeCollectionSummary[];
    routeBootstrap: RuntimeRouteBootstrap;
    collectionShards: Record<string, CollectionRuntimeShard>;
};

type WriteRuntimeArtifactsOptions = {
    collectionsFile: string;
    routeBootstrapFile: string;
    runtimeArtifactsDir: string;
};

const buildPreview = (text: string) => {
    if (text.trim() === '') {
        return '';
    }

    const words = text.split(/\s+/).filter(Boolean);
    const preview = words.slice(0, 12).join(' ');
    return words.length > 12 ? `${preview}…` : preview;
};

type BuiltSectionShard = {
    summary: SectionSummary;
    descriptors: CollectionRuntimeShard['sectionDescriptors'][string];
    excerptIds: string[];
    excerptLookup: Record<string, ExcerptLookupEntry>;
};

const buildEmptySectionRuntimeShard = (sectionId: string, headingMarker?: Excerpt): BuiltSectionShard => ({
    summary: {
        sectionId,
        title: headingMarker?.text || `Section ${sectionId}`,
        titleArabic: headingMarker?.nass ?? '',
        excerptCount: 0,
        firstPage: headingMarker?.from ?? 0,
    },
    descriptors: [],
    excerptIds: [],
    excerptLookup: {},
});

const buildSectionShardArtifacts = async (sectionId: string, chunkKeys: string[], chunksDir: string) => {
    const descriptors: CollectionRuntimeShard['sectionDescriptors'][string] = [];
    const excerptLookup: Record<string, ExcerptLookupEntry> = {};
    let headingTitle = `Section ${sectionId}`;
    let headingTitleArabic = '';
    let firstPage = 0;

    for (const chunkKey of chunkKeys) {
        const chunk = await readChunkFromDisk(chunksDir, chunkKey);
        const headingIndex = chunk.excerpts.findIndex((excerpt) => excerpt.id === sectionId);
        const start = headingIndex === -1 ? 0 : headingIndex + 1;
        const end = chunk.excerpts.length - 1;

        if (headingIndex >= 0) {
            const heading = chunk.excerpts[headingIndex];
            headingTitle = heading.text;
            headingTitleArabic = heading.nass;
            firstPage = heading.from;
        }

        if (start <= end) {
            descriptors.push(buildSectionChunkDescriptor(chunkKey, start, end));
        }

        for (const excerpt of chunk.excerpts) {
            if (excerpt.id === sectionId) {
                continue;
            }

            excerptLookup[excerpt.id] = {
                sectionId,
                chunkKey,
                preview: buildPreview(excerpt.text),
            };
        }
    }

    return {
        descriptors,
        excerptLookup,
        headingTitle,
        headingTitleArabic,
        firstPage,
    };
};

const buildSectionRuntimeShard = async (
    collectionId: string,
    sectionId: string,
    indexes: LookupIndexes,
    chunksDir: string,
    headingMarker?: Excerpt,
): Promise<BuiltSectionShard> => {
    const chunkKeys = indexes.sectionToChunks[collectionId]?.[sectionId] ?? [];
    const excerptIds = indexes.sectionToExcerpts[collectionId]?.[sectionId] ?? [];
    if (chunkKeys.length === 0) {
        if (excerptIds.length === 0) {
            return buildEmptySectionRuntimeShard(sectionId, headingMarker);
        }

        throw new Error(`Missing chunk descriptors for section ${collectionId}/${sectionId}`);
    }

    const details = await buildSectionShardArtifacts(sectionId, chunkKeys, chunksDir);

    return {
        summary: {
            sectionId,
            title: details.headingTitle,
            titleArabic: details.headingTitleArabic,
            excerptCount: excerptIds.length,
            firstPage: details.firstPage,
        },
        descriptors: details.descriptors,
        excerptIds,
        excerptLookup: details.excerptLookup,
    };
};

const buildCollectionRuntimeShard = async (
    collection: RuntimeCollectionSummary,
    indexes: LookupIndexes,
    chunksDir: string,
    generatedAt: string,
    headingMarkers?: Map<string, Excerpt>,
) => {
    const sectionOrder = indexes.collectionToSections[collection.id] ?? [];
    const sectionSummaries: Record<string, SectionSummary> = {};
    const sectionDescriptors: CollectionRuntimeShard['sectionDescriptors'] = {};
    const sectionExcerpts: CollectionRuntimeShard['sectionExcerpts'] = {};
    const excerptLookup: CollectionRuntimeShard['excerptLookup'] = {};
    for (const sectionId of sectionOrder) {
        const section = await buildSectionRuntimeShard(
            collection.id,
            sectionId,
            indexes,
            chunksDir,
            headingMarkers?.get(sectionId),
        );
        sectionSummaries[sectionId] = section.summary;
        sectionDescriptors[sectionId] = section.descriptors;
        sectionExcerpts[sectionId] = section.excerptIds;
        Object.assign(excerptLookup, section.excerptLookup);
    }

    const shard: CollectionRuntimeShard = {
        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
        generatedAt,
        collectionId: collection.id,
        sectionOrder,
        sectionSummaries,
        sectionDescriptors,
        sectionExcerpts,
        excerptLookup,
    };

    return assertCollectionRuntimeShard(shard);
};

export const buildRuntimeArtifacts = async (options: BuildRuntimeArtifactsOptions) => {
    const collections: RuntimeCollectionSummary[] = options.collections.map((collection) => ({
        ...collection,
        sectionCount: options.indexes.collectionToSections[collection.id]?.length ?? 0,
    }));
    const routeBootstrap: RuntimeRouteBootstrap = {
        artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
        generatedAt: options.generatedAt,
        collectionsBySlug: Object.fromEntries(
            collections.map((collection) => [collection.slug, { id: collection.id }]),
        ),
    };
    const collectionShards = Object.fromEntries(
        await Promise.all(
            collections.map(async (collection) => [
                collection.id,
                await buildCollectionRuntimeShard(
                    collection,
                    options.indexes,
                    options.chunksDir,
                    options.generatedAt,
                    options.headingMarkersByCollection?.[collection.id],
                ),
            ]),
        ),
    );

    return {
        collections: assertRuntimeCollectionSummaryArray(collections),
        routeBootstrap: assertRuntimeRouteBootstrap(routeBootstrap),
        collectionShards,
    } satisfies BuiltRuntimeArtifacts;
};

const writeJsonFile = async (filePath: string, value: unknown) => {
    await mkdir(dirname(filePath), { recursive: true });
    await Bun.write(filePath, JSON.stringify(value, null, 2));
};

export const writeRuntimeArtifacts = async (
    artifacts: BuiltRuntimeArtifacts,
    options: WriteRuntimeArtifactsOptions,
) => {
    await writeJsonFile(options.collectionsFile, artifacts.collections);
    await writeJsonFile(options.routeBootstrapFile, artifacts.routeBootstrap);

    await Promise.all(
        Object.entries(artifacts.collectionShards).map(([collectionId, shard]) =>
            writeJsonFile(join(options.runtimeArtifactsDir, 'collections', `${collectionId}.json`), shard),
        ),
    );
};
