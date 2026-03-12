import type { Collection } from '@/types/excerpts';
import { ARTIFACT_SCHEMA_VERSION } from './datasetManifest';

export type RuntimeCollectionSummary = Collection & {
    sectionCount: number;
};

export type RuntimeRouteBootstrap = {
    artifactSchemaVersion: number;
    generatedAt: string;
    collectionsBySlug: Record<
        string,
        {
            id: string;
        }
    >;
};

export type SectionChunkDescriptor = {
    chunkKey: string;
    start: number;
    end: number;
};

export type SectionSummary = {
    sectionId: string;
    title: string;
    titleArabic: string;
    excerptCount: number;
    firstPage: number;
};

export type ExcerptLookupEntry = {
    sectionId: string;
    chunkKey: string;
    preview: string;
};

export type CollectionRuntimeShard = {
    artifactSchemaVersion: number;
    generatedAt: string;
    collectionId: string;
    sectionOrder: string[];
    sectionSummaries: Record<string, SectionSummary>;
    sectionDescriptors: Record<string, SectionChunkDescriptor[]>;
    sectionExcerpts: Record<string, string[]>;
    excerptLookup: Record<string, ExcerptLookupEntry>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isIsoDateString = (value: unknown): value is string =>
    isNonEmptyString(value) && !Number.isNaN(Date.parse(value));

export const isRuntimeCollectionSummary = (value: unknown): value is RuntimeCollectionSummary => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isNonEmptyString(value.id) &&
        isNonEmptyString(value.slug) &&
        isNonEmptyString(value.roman) &&
        isNonEmptyString(value.unwan) &&
        Array.isArray(value.authors) &&
        isFiniteNumber(value.sectionCount)
    );
};

export const isRuntimeCollectionSummaryArray = (value: unknown): value is RuntimeCollectionSummary[] => {
    return Array.isArray(value) && value.every((entry) => isRuntimeCollectionSummary(entry));
};

export const isSectionChunkDescriptor = (value: unknown): value is SectionChunkDescriptor => {
    if (!isRecord(value)) {
        return false;
    }

    return isNonEmptyString(value.chunkKey) && isFiniteNumber(value.start) && isFiniteNumber(value.end);
};

const isSectionSummary = (value: unknown): value is SectionSummary => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isNonEmptyString(value.sectionId) &&
        isNonEmptyString(value.title) &&
        typeof value.titleArabic === 'string' &&
        isFiniteNumber(value.excerptCount) &&
        isFiniteNumber(value.firstPage)
    );
};

const isExcerptLookupEntry = (value: unknown): value is ExcerptLookupEntry => {
    if (!isRecord(value)) {
        return false;
    }

    return isNonEmptyString(value.sectionId) && isNonEmptyString(value.chunkKey) && isNonEmptyString(value.preview);
};

export const isRuntimeRouteBootstrap = (value: unknown): value is RuntimeRouteBootstrap => {
    if (!isRecord(value) || !isIsoDateString(value.generatedAt) || !isFiniteNumber(value.artifactSchemaVersion)) {
        return false;
    }

    if (!isRecord(value.collectionsBySlug)) {
        return false;
    }

    return Object.values(value.collectionsBySlug).every((entry) => isRecord(entry) && isNonEmptyString(entry.id));
};

export const isCollectionRuntimeShard = (value: unknown): value is CollectionRuntimeShard => {
    if (
        !isRecord(value) ||
        !isFiniteNumber(value.artifactSchemaVersion) ||
        !isIsoDateString(value.generatedAt) ||
        !isNonEmptyString(value.collectionId) ||
        !Array.isArray(value.sectionOrder)
    ) {
        return false;
    }

    if (
        !isRecord(value.sectionSummaries) ||
        !isRecord(value.sectionDescriptors) ||
        !isRecord(value.sectionExcerpts) ||
        !isRecord(value.excerptLookup)
    ) {
        return false;
    }

    return (
        value.sectionOrder.every((entry) => isNonEmptyString(entry)) &&
        Object.values(value.sectionSummaries).every((entry) => isSectionSummary(entry)) &&
        Object.values(value.sectionDescriptors).every(
            (entry) => Array.isArray(entry) && entry.every((descriptor) => isSectionChunkDescriptor(descriptor)),
        ) &&
        Object.values(value.sectionExcerpts).every(
            (entry) => Array.isArray(entry) && entry.every((excerptId) => isNonEmptyString(excerptId)),
        ) &&
        Object.values(value.excerptLookup).every((entry) => isExcerptLookupEntry(entry))
    );
};

export const assertRuntimeCollectionSummaryArray = (value: unknown): RuntimeCollectionSummary[] => {
    if (!isRuntimeCollectionSummaryArray(value)) {
        throw new Error('Invalid runtime collections payload');
    }

    return value;
};

export const assertRuntimeRouteBootstrap = (value: unknown): RuntimeRouteBootstrap => {
    if (!isRuntimeRouteBootstrap(value)) {
        throw new Error('Invalid runtime route bootstrap payload');
    }

    return value;
};

export const assertCollectionRuntimeShard = (value: unknown): CollectionRuntimeShard => {
    if (!isCollectionRuntimeShard(value)) {
        throw new Error('Invalid collection runtime shard payload');
    }

    return value;
};

export const buildSectionChunkDescriptor = (chunkKey: string, start: number, end: number) => ({
    chunkKey,
    start,
    end,
}) satisfies SectionChunkDescriptor;

export const buildRuntimeArtifactPayload = <T>(value: T) => ({
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    ...value,
});

export const getRuntimeRouteBootstrapObjectKey = (datasetVersion: string) =>
    `datasets/${datasetVersion}/artifacts/runtime/bootstrap/routes.json`;

export const getRuntimeCollectionShardObjectKey = (datasetVersion: string, collectionId: string) =>
    `datasets/${datasetVersion}/artifacts/runtime/collections/${collectionId}.json`;
