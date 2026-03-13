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

const isPlainRecord = (value: unknown): value is Record<string, unknown> => isRecord(value) && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const isNonNegativeInteger = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;

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
        isNonNegativeInteger(value.sectionCount)
    );
};

export const isRuntimeCollectionSummaryArray = (value: unknown): value is RuntimeCollectionSummary[] => {
    return Array.isArray(value) && value.every((entry) => isRuntimeCollectionSummary(entry));
};

export const isSectionChunkDescriptor = (value: unknown): value is SectionChunkDescriptor => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isNonEmptyString(value.chunkKey) &&
        isNonNegativeInteger(value.start) &&
        isNonNegativeInteger(value.end) &&
        value.start <= value.end
    );
};

const isSectionSummary = (value: unknown): value is SectionSummary => {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isNonEmptyString(value.sectionId) &&
        isNonEmptyString(value.title) &&
        typeof value.titleArabic === 'string' &&
        isNonNegativeInteger(value.excerptCount) &&
        isNonNegativeInteger(value.firstPage)
    );
};

const isExcerptLookupEntry = (value: unknown): value is ExcerptLookupEntry => {
    if (!isRecord(value)) {
        return false;
    }

    return isNonEmptyString(value.sectionId) && isNonEmptyString(value.chunkKey) && isNonEmptyString(value.preview);
};

export const isRuntimeRouteBootstrap = (value: unknown): value is RuntimeRouteBootstrap => {
    if (
        !isPlainRecord(value) ||
        !isIsoDateString(value.generatedAt) ||
        !isNonNegativeInteger(value.artifactSchemaVersion) ||
        value.artifactSchemaVersion !== ARTIFACT_SCHEMA_VERSION
    ) {
        return false;
    }

    if (!isPlainRecord(value.collectionsBySlug)) {
        return false;
    }

    return Object.values(value.collectionsBySlug).every((entry) => isRecord(entry) && isNonEmptyString(entry.id));
};

const hasRequiredSectionEntries = (value: CollectionRuntimeShard) => {
    return value.sectionOrder.every(
        (sectionId) =>
            sectionId in value.sectionSummaries &&
            sectionId in value.sectionDescriptors &&
            sectionId in value.sectionExcerpts,
    );
};

export const isCollectionRuntimeShard = (value: unknown): value is CollectionRuntimeShard => {
    if (
        !isPlainRecord(value) ||
        !isNonNegativeInteger(value.artifactSchemaVersion) ||
        value.artifactSchemaVersion !== ARTIFACT_SCHEMA_VERSION ||
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

    const candidate = value as CollectionRuntimeShard;
    return (
        candidate.sectionOrder.every((entry) => isNonEmptyString(entry)) &&
        hasRequiredSectionEntries(candidate) &&
        Object.values(candidate.sectionSummaries).every((entry) => isSectionSummary(entry)) &&
        Object.values(candidate.sectionDescriptors).every(
            (entry) => Array.isArray(entry) && entry.every((descriptor) => isSectionChunkDescriptor(descriptor)),
        ) &&
        Object.values(candidate.sectionExcerpts).every(
            (entry) => Array.isArray(entry) && entry.every((excerptId) => isNonEmptyString(excerptId)),
        ) &&
        Object.values(candidate.excerptLookup).every((entry) => isExcerptLookupEntry(entry))
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

export const buildSectionChunkDescriptor = (chunkKey: string, start: number, end: number) =>
    ({
        chunkKey,
        start,
        end,
    }) satisfies SectionChunkDescriptor;

export const buildRuntimeArtifactPayload = <T>(value: T) => ({
    ...value,
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
});

export const getRuntimeRouteBootstrapObjectKey = (datasetVersion: string) =>
    `datasets/${datasetVersion}/artifacts/runtime/bootstrap/routes.json`;

export const getRuntimeCollectionShardObjectKey = (datasetVersion: string, collectionId: string) =>
    `datasets/${datasetVersion}/artifacts/runtime/collections/${collectionId}.json`;
