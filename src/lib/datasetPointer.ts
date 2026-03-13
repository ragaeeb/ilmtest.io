export const DATASET_CHANNELS = ['prod', 'preview'] as const;

export type DatasetChannel = (typeof DATASET_CHANNELS)[number];

export type DatasetPointer = {
    datasetVersion: string;
    manifestKey: string;
    publishedAt: string;
    notes?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const ISO_UTC_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const isIsoDateString = (value: unknown): value is string => {
    if (typeof value !== 'string' || !ISO_UTC_DATE_TIME_PATTERN.test(value)) {
        return false;
    }

    return !Number.isNaN(Date.parse(value));
};

export const isDatasetChannel = (value: string): value is DatasetChannel => {
    return DATASET_CHANNELS.includes(value as DatasetChannel);
};

export const getDatasetPointerKey = (channel: DatasetChannel) => `channels/${channel}.json`;

export const isDatasetPointer = (value: unknown): value is DatasetPointer => {
    if (!isRecord(value)) {
        return false;
    }

    if (typeof value.datasetVersion !== 'string' || value.datasetVersion.length === 0) {
        return false;
    }

    if (typeof value.manifestKey !== 'string' || value.manifestKey.length === 0) {
        return false;
    }

    if (!isIsoDateString(value.publishedAt)) {
        return false;
    }

    if ('notes' in value && value.notes !== undefined && typeof value.notes !== 'string') {
        return false;
    }

    return true;
};

export const assertDatasetPointer = (value: unknown): DatasetPointer => {
    if (!isDatasetPointer(value)) {
        throw new Error('Invalid dataset pointer payload');
    }

    return value;
};
