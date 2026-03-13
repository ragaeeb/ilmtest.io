import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type DeployTarget = 'prod' | 'preview';

type WorkerBindingConfig = {
    binding: string;
    bucket_name: string;
    preview_bucket_name?: string;
};

type RootWranglerEnv = {
    name?: string;
    preview_urls?: boolean;
    vars?: Record<string, string>;
    r2_buckets?: WorkerBindingConfig[];
};

type RootWranglerConfig = {
    name?: string;
    preview_urls?: boolean;
    vars?: Record<string, string>;
    r2_buckets?: WorkerBindingConfig[];
    env?: Record<string, RootWranglerEnv>;
};

type GeneratedWorkerConfig = Record<string, unknown> & {
    name?: string;
    preview_urls?: boolean;
    vars?: Record<string, string>;
    r2_buckets?: WorkerBindingConfig[];
};

const GENERATED_CONFIG_PATH = join('dist', 'functions', 'wrangler.json');
const ROOT_CONFIG_PATH = 'wrangler.jsonc';

const isDeployTarget = (value: string): value is DeployTarget => value === 'prod' || value === 'preview';

export const buildWorkerDeployConfig = (
    generatedConfig: GeneratedWorkerConfig,
    rootConfig: RootWranglerConfig,
    target: DeployTarget,
) => {
    const config = structuredClone(generatedConfig);
    const envConfig = target === 'preview' ? rootConfig.env?.preview : null;

    config.name = envConfig?.name ?? rootConfig.name ?? config.name;
    config.preview_urls = envConfig?.preview_urls ?? rootConfig.preview_urls ?? config.preview_urls;
    config.vars = target === 'preview' ? { ...(envConfig?.vars ?? {}) } : { ...(rootConfig.vars ?? {}) };
    config.r2_buckets = target === 'preview' ? [...(envConfig?.r2_buckets ?? [])] : [...(rootConfig.r2_buckets ?? [])];

    return config;
};

export const prepareWorkerDeploy = async (target: DeployTarget) => {
    const generatedConfig = (await Bun.file(GENERATED_CONFIG_PATH).json()) as GeneratedWorkerConfig;
    const rootConfig = (await Bun.file(ROOT_CONFIG_PATH).json()) as RootWranglerConfig;
    const outputPath = join('dist', 'functions', `wrangler.${target}.json`);
    const config = buildWorkerDeployConfig(generatedConfig, rootConfig, target);

    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, JSON.stringify(config, null, 2));

    return {
        outputPath,
        config,
    };
};

const main = async () => {
    const targetArg = process.argv[2] ?? 'prod';
    if (!isDeployTarget(targetArg)) {
        throw new Error(`Unknown deploy target "${targetArg}". Expected "prod" or "preview".`);
    }

    const prepared = await prepareWorkerDeploy(targetArg);
    console.log(JSON.stringify(prepared, null, 2));
};

if (import.meta.main) {
    await main();
}
