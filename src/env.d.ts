declare module 'cloudflare:workers' {
    export const env: {
        EXCERPT_BUCKET?: {
            get(key: string): Promise<{ text(): Promise<string> } | null>;
        };
        ILMTEST_RUNTIME_CHANNEL?: 'prod' | 'preview';
        ILMTEST_DATASET_VERSION_OVERRIDE?: string;
    };
}
