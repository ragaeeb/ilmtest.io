export type RuntimeDataErrorCode =
    | 'artifact-missing'
    | 'chunk-missing'
    | 'binding-missing'
    | 'invalid-artifact'
    | 'local-artifact-missing';

type RuntimeDataErrorDetails = {
    statusCode?: number;
    datasetVersion?: string;
    manifestKey?: string | null;
    artifactKey?: string;
    chunkKey?: string;
    collectionId?: string;
};

export class RuntimeDataError extends Error {
    readonly code: RuntimeDataErrorCode;
    readonly statusCode: number;
    readonly datasetVersion?: string;
    readonly manifestKey?: string | null;
    readonly artifactKey?: string;
    readonly chunkKey?: string;
    readonly collectionId?: string;

    constructor(code: RuntimeDataErrorCode, message: string, details: RuntimeDataErrorDetails = {}) {
        super(message);
        this.name = 'RuntimeDataError';
        this.code = code;
        this.statusCode = details.statusCode ?? 503;
        this.datasetVersion = details.datasetVersion;
        this.manifestKey = details.manifestKey;
        this.artifactKey = details.artifactKey;
        this.chunkKey = details.chunkKey;
        this.collectionId = details.collectionId;
    }
}

export const isRuntimeDataError = (value: unknown): value is RuntimeDataError => value instanceof RuntimeDataError;

export const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
};
