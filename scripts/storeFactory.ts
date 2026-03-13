import { FileSystemObjectStore, S3CompatibleObjectStore } from './datasetControl';

export const getStore = () => {
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
