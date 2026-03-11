declare module 'cloudflare:workers' {
    export const env: {
        EXCERPT_BUCKET?: {
            get(key: string): Promise<{ text(): Promise<string> } | null>;
        };
    };
}
