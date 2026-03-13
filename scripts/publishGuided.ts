import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type { DatasetChannel } from '../src/lib/datasetPointer';
import {
    type ObjectStore,
    promoteDataset,
    publishDataset,
    validateLocalDataset,
    validateRemoteDataset,
} from './datasetControl';
import { setup } from './setup';
import { getStore } from './storeFactory';

const MAX_DATASET_VERSION_ATTEMPTS = 100;
const DEFAULT_PROMOTION_NOTES = 'Guided publish flow';

const formatLocalDatePart = (value: number) => String(value).padStart(2, '0');

export const formatLocalDate = (now = new Date()) =>
    `${now.getFullYear()}-${formatLocalDatePart(now.getMonth() + 1)}-${formatLocalDatePart(now.getDate())}`;

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

const promptWithDefault = async (rl: ReturnType<typeof createInterface>, label: string, defaultValue?: string) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    return answer || defaultValue || '';
};

const promptYesNo = async (rl: ReturnType<typeof createInterface>, label: string, defaultValue = true) => {
    const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
    const answer = (await rl.question(`${label}${suffix}: `)).trim().toLowerCase();

    if (answer === '') {
        return defaultValue;
    }

    if (['y', 'yes'].includes(answer)) {
        return true;
    }

    if (['n', 'no'].includes(answer)) {
        return false;
    }

    throw new Error('Please answer yes or no.');
};

const confirmExistingDatasetVersionIsFree = async (store: ObjectStore, datasetVersion: string) => {
    const existing = await store.headObject(getManifestKey(datasetVersion));
    if (existing) {
        throw new Error(`Dataset version already exists remotely: ${datasetVersion}`);
    }
};

const printStep = (message: string) => {
    console.log(`\n==> ${message}`);
};

const summarizeRun = (details: {
    collectionIds: string[];
    label: string;
    datasetVersion: string;
    promotePreview: boolean;
}) => {
    console.log('\nPublish plan');
    console.log(`Collections: ${details.collectionIds.join(' ')}`);
    console.log(`Release label: ${details.label}`);
    console.log(`Dataset version: ${details.datasetVersion}`);
    console.log(`Promote preview: ${details.promotePreview ? 'yes' : 'no'}`);
};

const promptCollectionIds = async (rl: ReturnType<typeof createInterface>) => {
    while (true) {
        try {
            return parseCollectionIds(await rl.question('Collection IDs (space or comma separated): '));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
        }
    }
};

const promptReleaseLabel = async (rl: ReturnType<typeof createInterface>, collectionIds: string[]) => {
    const defaultLabel = buildDefaultReleaseLabel(collectionIds);

    while (true) {
        try {
            const answer = await promptWithDefault(rl, 'Release label', defaultLabel);
            const sanitized = sanitizeReleaseLabel(answer);
            if (!sanitized) {
                throw new Error('Release label must contain at least one letter or number.');
            }
            return sanitized;
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
        }
    }
};

const promptDatasetVersion = async (rl: ReturnType<typeof createInterface>, store: ObjectStore, label: string) => {
    const suggested = await suggestDatasetVersion(store, label);

    while (true) {
        try {
            const answer = await promptWithDefault(rl, 'Dataset version', suggested);
            const datasetVersion = answer.trim();
            if (!datasetVersion) {
                throw new Error('Dataset version cannot be empty.');
            }
            await confirmExistingDatasetVersionIsFree(store, datasetVersion);
            return datasetVersion;
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
        }
    }
};

const promptPreviewPromotion = async (rl: ReturnType<typeof createInterface>) => {
    while (true) {
        try {
            return await promptYesNo(rl, 'Promote preview after publish?', true);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
        }
    }
};

const promptPromotionNotes = async (
    rl: ReturnType<typeof createInterface>,
    channel: DatasetChannel,
    defaultValue = DEFAULT_PROMOTION_NOTES,
) => {
    return await promptWithDefault(rl, `${channel} promotion notes`, defaultValue);
};

export const runPublishGuided = async () => {
    if (!input.isTTY || !output.isTTY) {
        throw new Error('publish-guided requires an interactive terminal.');
    }

    const rl = createInterface({ input, output });

    try {
        console.log('Guided corpus publish');
        console.log('This will run setup, validate the generated dataset, publish it, and optionally promote preview.');

        const store = getStore();
        const collectionIds = await promptCollectionIds(rl);
        const label = await promptReleaseLabel(rl, collectionIds);
        const datasetVersion = await promptDatasetVersion(rl, store, label);
        const promotePreview = await promptPreviewPromotion(rl);
        const previewNotes = promotePreview ? await promptPromotionNotes(rl, 'preview') : undefined;

        summarizeRun({
            collectionIds,
            label,
            datasetVersion,
            promotePreview,
        });

        if (!(await promptYesNo(rl, 'Continue?', true))) {
            console.log('Aborted.');
            return;
        }

        printStep(`Running setup for ${collectionIds.length} collection(s)`);
        await setup(...collectionIds);

        printStep(`Validating local dataset ${datasetVersion}`);
        const localValidation = await validateLocalDataset(undefined, datasetVersion);
        console.log(JSON.stringify(localValidation, null, 2));

        printStep(`Publishing dataset ${datasetVersion}`);
        const publishResult = await publishDataset(store, { datasetVersion });
        console.log(JSON.stringify(publishResult, null, 2));

        printStep(`Validating remote dataset ${datasetVersion}`);
        const remoteValidation = await validateRemoteDataset(store, { datasetVersion });
        console.log(JSON.stringify(remoteValidation, null, 2));

        if (promotePreview) {
            printStep(`Promoting preview to ${datasetVersion}`);
            const promotionResult = await promoteDataset(store, {
                channel: 'preview',
                datasetVersion,
                notes: previewNotes || undefined,
            });
            console.log(JSON.stringify(promotionResult, null, 2));

            printStep('Validating preview pointer');
            const previewValidation = await validateRemoteDataset(store, { channel: 'preview' });
            console.log(JSON.stringify(previewValidation, null, 2));
        }

        console.log('\nNext step');
        console.log('Run `bun run deploy:preview` to test the Worker against the preview dataset.');
    } finally {
        rl.close();
    }
};

if (import.meta.main) {
    await runPublishGuided();
}
