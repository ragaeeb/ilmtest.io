import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { applyEdits, findNodeAtLocation, modify, parse, parseTree } from 'jsonc-parser';

const DEFAULT_R2_BUCKET_NAME = 'ilmtest-datasets';
const WRANGLER_CONFIG_PATH = 'wrangler.jsonc';
const ENV_FILE_PATH = '.env';

type StepStatus = 'ok' | 'error' | 'skipped';

type StepRecord = {
    name: string;
    status: StepStatus;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    stdoutPath?: string;
    stderrPath?: string;
    detailPath?: string;
    message?: string;
    exitCode?: number;
};

type CloudflareSessionSummary = {
    startedAt: string;
    finishedAt?: string;
    logDir: string;
    envPath: string;
    wranglerConfigPath: string;
    bucketName?: string;
    accountId?: string;
    hasAccessKeyId: boolean;
    hasSecretAccessKey: boolean;
    bucketStatus?: 'existing' | 'created' | 'skipped';
    steps: StepRecord[];
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
};

type WranglerMembership = {
    id: string;
    name?: string;
};

type CommandResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    stdoutPath: string;
    stderrPath: string;
};

type EnvMap = Record<string, string>;

type WranglerConfig = {
    r2_buckets?: Array<Record<string, unknown>>;
    env?: Record<string, { r2_buckets?: Array<Record<string, unknown>> }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const serializeError = (error: unknown) => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }

    return {
        name: 'Error',
        message: String(error),
    };
};

const sanitizeFileStem = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const formatLogTimestamp = (now = new Date()) =>
    now
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replace(/:/g, '-');

const createSessionLogDir = () => join('tmp', 'cloudflare-guided', formatLogTimestamp());

const formatEnvValue = (value: string) =>
    `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

const parseEnvValue = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
};

const extractAccountIdFromEndpoint = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }

    try {
        const url = new URL(trimmed);
        const match = url.hostname.match(/^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/i);
        return match?.[1];
    } catch {
        return undefined;
    }
};

const parseWranglerMemberships = (value: unknown): WranglerMembership[] => {
    if (!isRecord(value)) {
        return [];
    }

    const directAccounts = Array.isArray(value.accounts) ? value.accounts : [];
    const directMemberships = directAccounts
        .filter(isRecord)
        .map((entry) => ({
            id: typeof entry.id === 'string' ? entry.id : '',
            name: typeof entry.name === 'string' ? entry.name : undefined,
        }))
        .filter((entry) => entry.id);

    if (directMemberships.length > 0) {
        return directMemberships;
    }

    const memberships = Array.isArray(value.memberships) ? value.memberships : [];
    return memberships
        .filter(isRecord)
        .map((entry) => {
            const account = isRecord(entry.account) ? entry.account : entry;
            return {
                id: typeof account.id === 'string' ? account.id : '',
                name: typeof account.name === 'string' ? account.name : undefined,
            };
        })
        .filter((entry) => entry.id);
};

const readEnvFile = async (filePath: string): Promise<EnvMap> => {
    const raw = await readFile(filePath, 'utf8').catch((error) => {
        if (isRecord(error) && error.code === 'ENOENT') {
            return null;
        }
        throw error;
    });

    if (raw === null) {
        return {};
    }

    const entries: EnvMap = {};
    for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match) {
            continue;
        }

        const [, key, value] = match;
        entries[key] = parseEnvValue(value);
    }

    return entries;
};

export const writeEnvFile = async (filePath: string, updates: EnvMap) => {
    const raw = await readFile(filePath, 'utf8').catch((error) => {
        if (isRecord(error) && error.code === 'ENOENT') {
            return '';
        }
        throw error;
    });

    const lines = raw === '' ? [] : raw.split(/\r?\n/);
    const pending = new Map(Object.entries(updates));
    const nextLines = lines.map((line) => {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (!match) {
            return line;
        }

        const key = match[1];
        const value = pending.get(key);
        if (value === undefined) {
            return line;
        }

        pending.delete(key);
        return `${key}=${formatEnvValue(value)}`;
    });

    if (nextLines.length > 0 && nextLines.at(-1)?.trim() !== '') {
        nextLines.push('');
    }

    for (const [key, value] of pending) {
        nextLines.push(`${key}=${formatEnvValue(value)}`);
    }

    const outputText = `${nextLines.join('\n').replace(/\n+$/u, '\n')}`;
    await writeFile(filePath, outputText, 'utf8');
};

export const updateWranglerBucketBindings = async (filePath: string, bucketName: string) => {
    const raw = await readFile(filePath, 'utf8');
    const tree = parseTree(raw);
    if (!tree) {
        throw new Error(`Failed to parse wrangler config: ${filePath}`);
    }

    const parsed = parse(raw) as WranglerConfig;
    const edits: import('jsonc-parser').Edit[] = [];

    const updateEntries = (entries: Array<Record<string, unknown>>, pathPrefix: (string | number)[]) => {
        for (const [index, entry] of entries.entries()) {
            if (entry.binding === 'EXCERPT_BUCKET') {
                edits.push(
                    ...modify(raw, [...pathPrefix, index, 'bucket_name'], bucketName, {
                        formattingOptions: { insertSpaces: true, tabSize: 4 },
                    }),
                    ...modify(raw, [...pathPrefix, index, 'preview_bucket_name'], bucketName, {
                        formattingOptions: { insertSpaces: true, tabSize: 4 },
                    }),
                );
            }
        }
    };

    if (parsed.r2_buckets && findNodeAtLocation(tree, ['r2_buckets'])) {
        updateEntries(parsed.r2_buckets, ['r2_buckets']);
    }

    if (parsed.env && findNodeAtLocation(tree, ['env'])) {
        for (const [envName, envConfig] of Object.entries(parsed.env)) {
            if (envConfig.r2_buckets && findNodeAtLocation(tree, ['env', envName, 'r2_buckets'])) {
                updateEntries(envConfig.r2_buckets, ['env', envName, 'r2_buckets']);
            }
        }
    }

    const nextText =
        edits.length > 0
            ? applyEdits(
                  raw,
                  edits.sort((a, b) => a.offset - b.offset),
              )
            : raw;
    await writeFile(filePath, nextText.endsWith('\n') ? nextText : `${nextText}\n`, 'utf8');
};

class CloudflareLogger {
    #summary: CloudflareSessionSummary;
    #eventsPath: string;

    constructor(logDir: string) {
        this.#summary = {
            startedAt: new Date().toISOString(),
            logDir,
            envPath: ENV_FILE_PATH,
            wranglerConfigPath: WRANGLER_CONFIG_PATH,
            hasAccessKeyId: false,
            hasSecretAccessKey: false,
            steps: [],
        };
        this.#eventsPath = join(logDir, 'events.log');
    }

    get summary() {
        return this.#summary;
    }

    async init() {
        await mkdir(this.#summary.logDir, { recursive: true });
        await this.appendEvent('cloudflare-guided started');
        await this.writeSummary();
    }

    async appendEvent(message: string) {
        await appendFile(this.#eventsPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
    }

    async recordStep(
        step: Omit<StepRecord, 'startedAt' | 'finishedAt' | 'durationMs'> & { startedAt: number; finishedAt: number },
    ) {
        this.#summary.steps.push({
            ...step,
            startedAt: new Date(step.startedAt).toISOString(),
            finishedAt: new Date(step.finishedAt).toISOString(),
            durationMs: step.finishedAt - step.startedAt,
        });
        await this.writeSummary();
    }

    async setSummaryFields(
        fields: Partial<Omit<CloudflareSessionSummary, 'steps' | 'logDir' | 'startedAt' | 'finishedAt' | 'error'>>,
    ) {
        Object.assign(this.#summary, fields);
        await this.writeSummary();
    }

    async writeJson(fileName: string, value: unknown) {
        const filePath = join(this.#summary.logDir, fileName);
        await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
        return filePath;
    }

    async writeText(fileName: string, value: string) {
        const filePath = join(this.#summary.logDir, fileName);
        await writeFile(filePath, value, 'utf8');
        return filePath;
    }

    async fail(error: unknown) {
        this.#summary.error = serializeError(error);
        this.#summary.finishedAt = new Date().toISOString();
        await this.writeSummary();
        await this.writeJson('error.json', this.#summary.error);
    }

    async finish() {
        this.#summary.finishedAt = new Date().toISOString();
        await this.appendEvent('cloudflare-guided finished');
        await this.writeSummary();
    }

    private async writeSummary() {
        await writeFile(join(this.#summary.logDir, 'summary.json'), JSON.stringify(this.#summary, null, 2), 'utf8');
    }
}

const promptWithDefault = async (rl: ReturnType<typeof createInterface>, label: string, defaultValue?: string) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    return answer || defaultValue || '';
};

const promptYesNo = async (rl: ReturnType<typeof createInterface>, label: string, defaultValue: boolean) => {
    while (true) {
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

        console.error('Please answer yes or no.');
    }
};

const promptRequiredValue = async (rl: ReturnType<typeof createInterface>, label: string, existingValue?: string) => {
    while (true) {
        const suffix = existingValue ? ' [leave blank to keep existing]' : '';
        const answer = (await rl.question(`${label}${suffix}: `)).trim();
        if (answer) {
            return answer;
        }
        if (existingValue) {
            return existingValue;
        }
        console.error(`${label} is required.`);
    }
};

const runCommandStep = async (
    logger: CloudflareLogger,
    stepName: string,
    command: string[],
): Promise<CommandResult> => {
    const startedAt = Date.now();
    await logger.appendEvent(`running step ${stepName}: ${command.join(' ')}`);

    const child = Bun.spawn(command, {
        cwd: process.cwd(),
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
        child.stdout ? new Response(child.stdout).text() : Promise.resolve(''),
        child.stderr ? new Response(child.stderr).text() : Promise.resolve(''),
        child.exited,
    ]);

    const stem = sanitizeFileStem(stepName);
    const stdoutPath = await logger.writeText(`${stem}.stdout.log`, stdout);
    const stderrPath = await logger.writeText(`${stem}.stderr.log`, stderr);
    const finishedAt = Date.now();

    await logger.recordStep({
        name: stepName,
        status: exitCode === 0 ? 'ok' : 'error',
        startedAt,
        finishedAt,
        stdoutPath,
        stderrPath,
        exitCode,
        message: exitCode === 0 ? undefined : `Command failed with exit code ${exitCode}`,
    });

    return { stdout, stderr, exitCode, stdoutPath, stderrPath };
};

const recordSkippedStep = async (logger: CloudflareLogger, stepName: string, message: string) => {
    const startedAt = Date.now();
    await logger.appendEvent(`skipping step ${stepName}: ${message}`);
    await logger.recordStep({
        name: stepName,
        status: 'skipped',
        startedAt,
        finishedAt: startedAt,
        message,
    });
};

const loadWranglerIdentity = async (logger: CloudflareLogger) => {
    const result = await runCommandStep(logger, 'wrangler-whoami', [
        process.execPath,
        'x',
        'wrangler',
        'whoami',
        '--json',
    ]);
    if (result.exitCode !== 0) {
        throw new Error(
            `Wrangler is not authenticated. Run \`bunx wrangler login\` and retry. Logs: ${result.stdoutPath}, ${result.stderrPath}`,
        );
    }

    const parsed = JSON.parse(result.stdout) as unknown;
    const memberships = parseWranglerMemberships(parsed);
    await logger.writeJson('wrangler-whoami.json', parsed);
    return memberships;
};

const ensureBucketExists = async (logger: CloudflareLogger, bucketName: string) => {
    const info = await runCommandStep(logger, 'bucket-info', [
        process.execPath,
        'x',
        'wrangler',
        'r2',
        'bucket',
        'info',
        bucketName,
    ]);
    if (info.exitCode === 0) {
        await logger.setSummaryFields({ bucketStatus: 'existing' });
        return 'existing' as const;
    }

    const create = await runCommandStep(logger, 'bucket-create', [
        process.execPath,
        'x',
        'wrangler',
        'r2',
        'bucket',
        'create',
        bucketName,
    ]);

    if (create.exitCode !== 0) {
        throw new Error(`Could not create bucket ${bucketName}. See ${create.stdoutPath} and ${create.stderrPath}`);
    }

    await logger.setSummaryFields({ bucketStatus: 'created' });
    return 'created' as const;
};

const buildEndpointFromAccountId = (accountId: string) => `https://${accountId}.r2.cloudflarestorage.com`;

const printMembershipHints = (memberships: WranglerMembership[]) => {
    if (memberships.length === 0) {
        return;
    }

    console.log('\nWrangler account memberships');
    for (const membership of memberships) {
        console.log(`- ${membership.name ? `${membership.name} ` : ''}(${membership.id})`);
    }
};

export const runCloudflareGuided = async () => {
    if (!input.isTTY || !output.isTTY) {
        throw new Error('cloudflare-guided requires an interactive terminal.');
    }

    const rl = createInterface({ input, output });
    const logger = new CloudflareLogger(createSessionLogDir());
    await logger.init();

    try {
        const existingEnv = await readEnvFile(ENV_FILE_PATH);
        const memberships = await loadWranglerIdentity(logger);
        const existingBucketName = existingEnv.R2_BUCKET || DEFAULT_R2_BUCKET_NAME;
        const existingAccountId =
            existingEnv.CF_ACCOUNT_ID ??
            existingEnv.R2_ACCOUNT_ID ??
            extractAccountIdFromEndpoint(existingEnv.R2_ENDPOINT) ??
            (memberships.length === 1 ? memberships[0]?.id : undefined);
        const existingAccessKeyId = existingEnv.R2_ACCESS_KEY_ID;
        const existingSecretAccessKey = existingEnv.R2_SECRET_ACCESS_KEY;

        console.log('Guided Cloudflare bootstrap');
        console.log(`Logs: ${logger.summary.logDir}`);
        console.log(
            'This will verify Wrangler auth, ensure the dataset bucket exists, update .env, and sync wrangler.jsonc.',
        );
        printMembershipHints(memberships);

        const bucketName = await promptWithDefault(rl, 'Dataset R2 bucket name', existingBucketName);
        const shouldEnsureBucket = await promptYesNo(rl, 'Create or verify the R2 bucket with Wrangler now?', true);
        const accountId = await promptRequiredValue(rl, 'Cloudflare account ID', existingAccountId);

        console.log('\nBootstrap plan');
        console.log(`Bucket: ${bucketName}`);
        console.log(`Account ID: ${accountId}`);
        console.log(`Ensure bucket now: ${shouldEnsureBucket ? 'yes' : 'no'}`);
        console.log(`Write ${ENV_FILE_PATH}: yes`);
        console.log(`Update ${WRANGLER_CONFIG_PATH}: yes`);
        if (!(await promptYesNo(rl, 'Continue?', true))) {
            await recordSkippedStep(logger, 'cloudflare-bootstrap', 'user aborted before execution');
            await logger.finish();
            console.log(`Aborted. Logs: ${logger.summary.logDir}`);
            return;
        }

        await logger.setSummaryFields({
            bucketName,
            accountId,
            bucketStatus: shouldEnsureBucket ? undefined : 'skipped',
        });

        if (shouldEnsureBucket) {
            await ensureBucketExists(logger, bucketName);
        } else {
            await recordSkippedStep(logger, 'bucket-create', 'bucket verification skipped by user');
        }

        console.log('\nNext, create an R2 API token in the Cloudflare dashboard.');
        console.log('Current UI path: R2 Object Storage -> Overview -> Account Details -> API Tokens -> Manage.');
        console.log(`Then create a token with Object Read & Write access for bucket ${bucketName}.`);
        console.log('Copy the Access Key ID and Secret Access Key now. The secret is only shown once.');

        const accessKeyId = await promptRequiredValue(rl, 'R2 Access Key ID', existingAccessKeyId);
        const secretAccessKey = await promptRequiredValue(
            rl,
            'R2 Secret Access Key (input is visible)',
            existingSecretAccessKey,
        );
        await logger.setSummaryFields({
            hasAccessKeyId: true,
            hasSecretAccessKey: true,
        });

        const envUpdates = {
            R2_BUCKET: bucketName,
            CF_ACCOUNT_ID: accountId,
            R2_ENDPOINT: buildEndpointFromAccountId(accountId),
            R2_ACCESS_KEY_ID: accessKeyId,
            R2_SECRET_ACCESS_KEY: secretAccessKey,
        };

        const writeEnvStartedAt = Date.now();
        await writeEnvFile(ENV_FILE_PATH, envUpdates);
        const envDetailPath = await logger.writeJson('env-updates.json', {
            R2_BUCKET: bucketName,
            CF_ACCOUNT_ID: accountId,
            R2_ENDPOINT: buildEndpointFromAccountId(accountId),
            R2_ACCESS_KEY_ID: '[configured]',
            R2_SECRET_ACCESS_KEY: '[configured]',
        });
        await logger.recordStep({
            name: 'write-env',
            status: 'ok',
            startedAt: writeEnvStartedAt,
            finishedAt: Date.now(),
            detailPath: envDetailPath,
        });

        const updateWranglerStartedAt = Date.now();
        await updateWranglerBucketBindings(WRANGLER_CONFIG_PATH, bucketName);
        const wranglerDetailPath = await logger.writeJson('wrangler-bucket.json', {
            bucketName,
            configPath: WRANGLER_CONFIG_PATH,
        });
        await logger.recordStep({
            name: 'update-wrangler-config',
            status: 'ok',
            startedAt: updateWranglerStartedAt,
            finishedAt: Date.now(),
            detailPath: wranglerDetailPath,
        });

        await logger.finish();

        console.log('\nCloudflare bootstrap complete.');
        console.log(`Updated ${ENV_FILE_PATH} and ${WRANGLER_CONFIG_PATH}.`);
        console.log('Next steps:');
        console.log('1. bun run publish-guided');
        console.log('2. bun run release-guided');
        console.log(`If anything fails later, attach the logs from ${logger.summary.logDir}.`);
    } catch (error) {
        await logger.fail(error);
        console.error(error instanceof Error ? error.message : String(error));
        console.error(`Logs: ${logger.summary.logDir}`);
        throw error;
    } finally {
        rl.close();
    }
};

if (import.meta.main) {
    await runCloudflareGuided();
}
