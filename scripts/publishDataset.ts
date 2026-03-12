import { isDatasetChannel } from '../src/lib/datasetPointer';
import {
    FileSystemObjectStore,
    promoteDataset,
    pruneDatasets,
    publishDataset,
    rollbackDataset,
    S3CompatibleObjectStore,
} from './datasetControl';

const getFlagValue = (args: string[], flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) {
        return undefined;
    }
    return args[index + 1];
};

const getStore = () => {
    if (process.env.DATASET_STORE_ROOT) {
        return new FileSystemObjectStore(process.env.DATASET_STORE_ROOT);
    }

    const bucketName = process.env.R2_BUCKET;
    const endpoint =
        process.env.R2_ENDPOINT ??
        (process.env.R2_ACCOUNT_ID || process.env.CF_ACCOUNT_ID
            ? `https://${process.env.R2_ACCOUNT_ID || process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`
            : undefined);
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!bucketName || !endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error(
            'Missing R2 configuration. Set DATASET_STORE_ROOT for local testing or provide R2_BUCKET, R2_ENDPOINT/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.',
        );
    }

    return new S3CompatibleObjectStore(bucketName, endpoint, accessKeyId, secretAccessKey);
};

const main = async () => {
    const [command, ...args] = process.argv.slice(2);
    if (!command) {
        throw new Error('Usage: bun scripts/publishDataset.ts <publish|promote|rollback|prune> [options]');
    }

    const store = getStore();

    switch (command) {
        case 'publish': {
            const result = await publishDataset(store, {
                datasetVersion: getFlagValue(args, '--dataset-version'),
                buildMetadataPath: getFlagValue(args, '--build-metadata'),
                stateDir: getFlagValue(args, '--state-dir'),
                maxConcurrency: getFlagValue(args, '--max-concurrency')
                    ? Number(getFlagValue(args, '--max-concurrency'))
                    : undefined,
            });
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        case 'promote':
        case 'rollback': {
            const channel = getFlagValue(args, '--channel') ?? args[0];
            const datasetVersion = getFlagValue(args, '--dataset-version') ?? args[1] ?? args[0];
            if (!channel || !isDatasetChannel(channel)) {
                throw new Error('promote/rollback requires --channel <prod|preview>');
            }
            if (!datasetVersion) {
                throw new Error('promote/rollback requires --dataset-version <value>');
            }

            const payload = {
                channel,
                datasetVersion,
                notes: getFlagValue(args, '--notes'),
            };
            const result =
                command === 'promote' ? await promoteDataset(store, payload) : await rollbackDataset(store, payload);
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        case 'prune': {
            const result = await pruneDatasets(store);
            console.log(JSON.stringify(result, null, 2));
            return;
        }
        default:
            throw new Error(`Unknown command: ${command}`);
    }
};

await main();
