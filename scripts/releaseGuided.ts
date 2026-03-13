import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type { DatasetChannel } from '../src/lib/datasetPointer';
import { type ObjectStore, promoteDataset, validateRemoteDataset } from './datasetControl';
import { prepareWorkerDeploy } from './prepareWorkerDeploy';
import { runRuntimeProbe } from './runtimeProbe';
import { runRouteSmoke } from './smokeRoutes';
import { getStore } from './storeFactory';

type StepStatus = 'pending' | 'ok' | 'error' | 'skipped';

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

type ReleaseSessionSummary = {
    startedAt: string;
    finishedAt?: string;
    logDir: string;
    datasetVersion?: string;
    previewUrl?: string;
    productionUrl?: string;
    steps: StepRecord[];
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
};

type RemoteState = Awaited<ReturnType<typeof validateRemoteDataset>>;

const DEFAULT_PREVIEW_NOTES = 'Guided release flow';
const DEFAULT_PROD_NOTES = 'Guided release flow';

const sanitizeFileStem = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

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

const formatLogTimestamp = (now = new Date()) =>
    now
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replace(/:/g, '-');

const createSessionLogDir = () => join('tmp', 'release-guided', formatLogTimestamp());

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

export const extractUrls = (text: string) => {
    return [...text.matchAll(/https:\/\/[^\s"'<>]+/g)].map((match) => match[0].replace(/[),.;]+$/, ''));
};

export const extractPreviewUrl = (text: string) => {
    const urls = extractUrls(text);
    const workersDev = urls.filter((url) => url.includes('workers.dev'));
    return workersDev.at(-1) ?? urls.at(-1) ?? null;
};

class ReleaseLogger {
    #summary: ReleaseSessionSummary;
    #eventsPath: string;

    constructor(logDir: string) {
        this.#summary = {
            startedAt: new Date().toISOString(),
            logDir,
            steps: [],
        };
        this.#eventsPath = join(logDir, 'events.log');
    }

    get summary() {
        return this.#summary;
    }

    async init() {
        await mkdir(this.#summary.logDir, { recursive: true });
        await this.appendEvent('release-guided started');
        await this.writeSummary();
    }

    async appendEvent(message: string) {
        await appendFile(this.#eventsPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
    }

    async setDatasetVersion(datasetVersion: string) {
        this.#summary.datasetVersion = datasetVersion;
        await this.writeSummary();
    }

    async setPreviewUrl(previewUrl: string) {
        this.#summary.previewUrl = previewUrl;
        await this.writeSummary();
    }

    async setProductionUrl(productionUrl: string) {
        this.#summary.productionUrl = productionUrl;
        await this.writeSummary();
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

    async writeJson(fileName: string, value: unknown) {
        const filePath = join(this.#summary.logDir, fileName);
        await writeFile(filePath, JSON.stringify(value, null, 2));
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
        await this.appendEvent('release-guided finished');
        await this.writeSummary();
    }

    private async writeSummary() {
        await writeFile(join(this.#summary.logDir, 'summary.json'), JSON.stringify(this.#summary, null, 2));
    }
}

const runCommandStep = async (logger: ReleaseLogger, stepName: string, command: string[]) => {
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

    if (exitCode !== 0) {
        throw new Error(`Step "${stepName}" failed. See ${stdoutPath} and ${stderrPath}`);
    }

    return { stdout, stderr, stdoutPath, stderrPath };
};

const runFunctionStep = async <T>(
    logger: ReleaseLogger,
    stepName: string,
    fn: () => Promise<T>,
    detailFileName?: string,
) => {
    const startedAt = Date.now();
    await logger.appendEvent(`running step ${stepName}`);

    try {
        const result = await fn();
        const finishedAt = Date.now();
        const detailPath = detailFileName ? await logger.writeJson(detailFileName, result) : undefined;

        await logger.recordStep({
            name: stepName,
            status: 'ok',
            startedAt,
            finishedAt,
            detailPath,
        });

        return result;
    } catch (error) {
        const finishedAt = Date.now();
        const detailPath = await logger.writeJson(`${sanitizeFileStem(stepName)}.error.json`, serializeError(error));
        await logger.recordStep({
            name: stepName,
            status: 'error',
            startedAt,
            finishedAt,
            detailPath,
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
};

const recordSkippedStep = async (logger: ReleaseLogger, stepName: string, message: string) => {
    const startedAt = Date.now();
    const finishedAt = startedAt;
    await logger.appendEvent(`skipping step ${stepName}: ${message}`);
    await logger.recordStep({
        name: stepName,
        status: 'skipped',
        startedAt,
        finishedAt,
        message,
    });
};

const loadChannelState = async (store: ObjectStore, channel: DatasetChannel) => {
    try {
        return await validateRemoteDataset(store, { channel });
    } catch {
        return null;
    }
};

const promptDatasetVersion = async (rl: ReturnType<typeof createInterface>, currentPreview: RemoteState | null) => {
    while (true) {
        const answer = await promptWithDefault(rl, 'Dataset version to deploy', currentPreview?.datasetVersion);
        if (answer.trim()) {
            return answer.trim();
        }
        console.error('Dataset version is required.');
    }
};

const promptUrl = async (rl: ReturnType<typeof createInterface>, label: string) => {
    while (true) {
        const answer = (await rl.question(`${label}: `)).trim();
        if (answer && URL.canParse(answer)) {
            return answer;
        }
        console.error('Enter a valid absolute URL.');
    }
};

const printRemoteState = (label: string, state: RemoteState | null) => {
    if (!state) {
        console.log(`${label}: not configured`);
        return;
    }

    console.log(`${label}: ${state.datasetVersion}`);
};

export const runReleaseGuided = async () => {
    if (!input.isTTY || !output.isTTY) {
        throw new Error('release-guided requires an interactive terminal.');
    }

    const store = getStore();
    const currentPreview = await loadChannelState(store, 'preview');
    const currentProd = await loadChannelState(store, 'prod');
    const rl = createInterface({ input, output });
    const logDir = createSessionLogDir();
    const logger = new ReleaseLogger(logDir);

    await logger.init();

    try {
        console.log('Guided release');
        console.log(`Logs: ${logDir}`);
        printRemoteState('Current preview', currentPreview);
        printRemoteState('Current prod', currentProd);

        const datasetVersion = await promptDatasetVersion(rl, currentPreview);
        await logger.setDatasetVersion(datasetVersion);

        const proceedToProd = await promptYesNo(rl, 'Continue to production after preview passes?', false);
        const previewNotes = await promptWithDefault(rl, 'Preview promotion notes', DEFAULT_PREVIEW_NOTES);
        const prodNotes = proceedToProd
            ? await promptWithDefault(rl, 'Production promotion notes', DEFAULT_PROD_NOTES)
            : '';

        console.log('\nRelease plan');
        console.log(`Dataset version: ${datasetVersion}`);
        console.log(`Continue to production: ${proceedToProd ? 'yes' : 'no'}`);
        if (!(await promptYesNo(rl, 'Continue?', true))) {
            await recordSkippedStep(logger, 'release', 'user aborted before execution');
            console.log(`Aborted. Logs: ${logDir}`);
            return;
        }

        await runFunctionStep(
            logger,
            'validate-remote-dataset',
            async () => await validateRemoteDataset(store, { datasetVersion }),
            'validate-remote-dataset.json',
        );

        if (currentPreview?.datasetVersion !== datasetVersion) {
            await runFunctionStep(
                logger,
                'promote-preview-pointer',
                async () =>
                    await promoteDataset(store, {
                        channel: 'preview',
                        datasetVersion,
                        notes: previewNotes || undefined,
                    }),
                'promote-preview-pointer.json',
            );
        } else {
            await recordSkippedStep(
                logger,
                'promote-preview-pointer',
                'preview already points at the requested dataset',
            );
        }

        await runFunctionStep(
            logger,
            'validate-preview-pointer',
            async () => await validateRemoteDataset(store, { channel: 'preview' }),
            'validate-preview-pointer.json',
        );

        await runCommandStep(logger, 'build', [process.execPath, 'run', 'build']);
        await runCommandStep(logger, 'bundle-check', [process.execPath, 'run', 'bundle-check']);
        await runCommandStep(logger, 'deploy-check-preview', [process.execPath, 'run', 'deploy-check:preview']);

        if (proceedToProd) {
            await runCommandStep(logger, 'deploy-check-prod', [process.execPath, 'run', 'deploy-check']);
        } else {
            await recordSkippedStep(logger, 'deploy-check-prod', 'production release not requested');
        }

        const preparedPreview = await runFunctionStep(
            logger,
            'prepare-preview-deploy',
            async () => await prepareWorkerDeploy('preview'),
            'prepare-preview-deploy.json',
        );

        const previewDeploy = await runCommandStep(logger, 'deploy-preview', [
            process.execPath,
            'x',
            'wrangler',
            'deploy',
            '--config',
            preparedPreview.outputPath,
        ]);

        const previewUrl =
            extractPreviewUrl(`${previewDeploy.stdout}\n${previewDeploy.stderr}`) ??
            (await promptUrl(rl, 'Preview URL'));
        await logger.setPreviewUrl(previewUrl);

        await runFunctionStep(
            logger,
            'smoke-preview',
            async () => await runRouteSmoke(previewUrl),
            'smoke-preview.json',
        );
        await runFunctionStep(
            logger,
            'runtime-probe-preview',
            async () => await runRuntimeProbe({ baseUrl: previewUrl }),
            'runtime-probe-preview.json',
        );

        if (!proceedToProd) {
            await recordSkippedStep(logger, 'release-prod', 'production release not requested');
            await logger.finish();
            console.log(`Preview release complete. Logs: ${logDir}`);
            return;
        }

        if (currentProd?.datasetVersion !== datasetVersion) {
            await runFunctionStep(
                logger,
                'promote-prod-pointer',
                async () =>
                    await promoteDataset(store, {
                        channel: 'prod',
                        datasetVersion,
                        notes: prodNotes || undefined,
                    }),
                'promote-prod-pointer.json',
            );
        } else {
            await recordSkippedStep(logger, 'promote-prod-pointer', 'prod already points at the requested dataset');
        }

        await runFunctionStep(
            logger,
            'validate-prod-pointer',
            async () => await validateRemoteDataset(store, { channel: 'prod' }),
            'validate-prod-pointer.json',
        );

        const preparedProd = await runFunctionStep(
            logger,
            'prepare-prod-deploy',
            async () => await prepareWorkerDeploy('prod'),
            'prepare-prod-deploy.json',
        );

        await runCommandStep(logger, 'deploy-prod', [
            process.execPath,
            'x',
            'wrangler',
            'deploy',
            '--config',
            preparedProd.outputPath,
        ]);
        await logger.setProductionUrl('https://ilmtest.io');

        await runFunctionStep(
            logger,
            'smoke-prod',
            async () => await runRouteSmoke('https://ilmtest.io'),
            'smoke-prod.json',
        );
        await runFunctionStep(
            logger,
            'runtime-probe-prod',
            async () => await runRuntimeProbe({ baseUrl: 'https://ilmtest.io' }),
            'runtime-probe-prod.json',
        );

        await logger.finish();
        console.log(`Production release complete. Logs: ${logDir}`);
    } catch (error) {
        await logger.fail(error);
        console.error(`Release failed. Logs: ${logDir}`);
        throw error;
    } finally {
        rl.close();
    }
};

if (import.meta.main) {
    await runReleaseGuided();
}
