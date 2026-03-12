import { isDatasetChannel } from '../src/lib/datasetPointer';
import {
    FileSystemObjectStore,
    S3CompatibleObjectStore,
    validateLocalDataset,
    validateRemoteDataset,
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
    const [mode = 'local', ...args] = process.argv.slice(2);

    if (mode === 'local') {
        const result = await validateLocalDataset(
            getFlagValue(args, '--build-metadata'),
            getFlagValue(args, '--dataset-version'),
        );
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (mode === 'remote') {
        const channelArg = getFlagValue(args, '--channel');
        const datasetVersion = getFlagValue(args, '--dataset-version');
        if (channelArg && !isDatasetChannel(channelArg)) {
            throw new Error('remote validation requires --channel <prod|preview> when channel is provided');
        }
        const channel = channelArg && isDatasetChannel(channelArg) ? channelArg : undefined;
        if (!channel && !datasetVersion) {
            throw new Error('remote validation requires either --channel or --dataset-version');
        }

        const result = await validateRemoteDataset(getStore(), {
            channel,
            datasetVersion,
        });
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    throw new Error(`Unknown validation mode: ${mode}`);
};

await main();
