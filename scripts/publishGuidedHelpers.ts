import type { ObjectStore } from './datasetControl';

const MAX_DATASET_VERSION_ATTEMPTS = 100;

const formatLocalDatePart = (value: number) => String(value).padStart(2, '0');

export const formatLocalDate = (now = new Date()) =>
    `${now.getUTCFullYear()}-${formatLocalDatePart(now.getUTCMonth() + 1)}-${formatLocalDatePart(now.getUTCDate())}`;

export const parseCollectionIds = (raw: string) => {
    const ids = raw
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean);

    if (ids.length === 0) {
        throw new Error('Enter at least one collection ID.');
    }

    const uniqueIds = [...new Set(ids)];
    const invalidId = uniqueIds.find((id) => !/^\d+$/.test(id));
    if (invalidId) {
        throw new Error(`Collection IDs must be numeric. Invalid value: ${invalidId}`);
    }

    return uniqueIds;
};

export const buildDefaultReleaseLabel = (collectionIds: string[]) => {
    if (collectionIds.length === 1) {
        return `book-${collectionIds[0]}`;
    }

    return `pilot-books${collectionIds.length}`;
};

export const sanitizeReleaseLabel = (raw: string) => {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
};

export const buildDatasetVersionBase = (label: string, now = new Date()) => {
    const sanitized = sanitizeReleaseLabel(label);
    if (!sanitized) {
        throw new Error('Release label must contain at least one letter or number.');
    }

    return `${formatLocalDate(now)}-${sanitized}`;
};

const getManifestKey = (datasetVersion: string) => `datasets/${datasetVersion}/manifest.json`;

export const suggestDatasetVersion = async (store: ObjectStore, label: string, now = new Date()) => {
    const base = buildDatasetVersionBase(label, now);

    for (let versionNumber = 1; versionNumber <= MAX_DATASET_VERSION_ATTEMPTS; versionNumber++) {
        const datasetVersion = `${base}-v${versionNumber}`;
        const existing = await store.headObject(getManifestKey(datasetVersion));
        if (!existing) {
            return datasetVersion;
        }
    }

    throw new Error(`Could not find an available dataset version for base ${base}`);
};
