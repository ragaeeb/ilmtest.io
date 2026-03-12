import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BASELINE_OUTPUT_PATH = join('docs', 'baselines', 'current.json');
const PAGE_SIZE = 100;

type DirectoryStats = {
    files: number;
    bytes: number;
};

type CommandStatus = {
    label: string;
    ok: boolean;
    exitCode: number;
    durationMs: number;
};

type DeployCoupling = {
    deployScript: string | null;
    usesPagesDeploy: boolean;
    usesLegacyUploadR2: boolean;
    publishDatasetScript: string | null;
};

export type BaselineReport = {
    generatedAt: string;
    collections: number;
    translators: number;
    srcData: DirectoryStats;
    excerptChunks: DirectoryStats;
    buildOutput: DirectoryStats;
    serverBundle: DirectoryStats & {
        topFiles: Array<{ path: string; bytes: number }>;
    };
    topSectionFanOut: Array<{
        collectionId: string;
        sectionId: string;
        excerptCount: number;
        chunkCount: number;
    }>;
    routeReadFanOut: {
        excerptRoute: {
            chunkReads: ReturnType<typeof summarizeValues>;
        };
        sectionRoute: {
            chunkReads: ReturnType<typeof summarizeValues>;
        };
        collectionRoute: {
            pageSize: number;
            chunkReads: ReturnType<typeof summarizeValues>;
        };
    };
    commands: CommandStatus[];
    deployCoupling: DeployCoupling;
};

const percentile = (values: number[], fraction: number) => {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return sorted[index];
};

const summarizeValues = (values: number[]) => {
    if (values.length === 0) {
        return { min: 0, max: 0, avg: 0, p95: 0 };
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    return {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: Number((total / values.length).toFixed(2)),
        p95: percentile(values, 0.95),
    };
};

const walkDirectory = async (dir: string): Promise<DirectoryStats> => {
    const entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true }).catch(() => null);
    if (!entries) {
        return { files: 0, bytes: 0 };
    }

    let files = 0;
    let bytes = 0;
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            const nested = await walkDirectory(fullPath);
            files += nested.files;
            bytes += nested.bytes;
            continue;
        }

        files += 1;
        bytes += Bun.file(fullPath).size;
    }

    return { files, bytes };
};

const topFiles = async (dir: string, limit = 10) => {
    const entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true }).catch(() => []);
    const files: Array<{ path: string; bytes: number }> = [];

    const walk = async (baseDir: string, currentEntries: typeof entries) => {
        for (const entry of currentEntries) {
            const fullPath = join(baseDir, entry.name);
            if (entry.isDirectory()) {
                const nested = await readdir(fullPath, { encoding: 'utf8', withFileTypes: true });
                await walk(fullPath, nested);
                continue;
            }
            files.push({ path: fullPath, bytes: Bun.file(fullPath).size });
        }
    };

    await walk(dir, entries);
    return files.sort((left, right) => right.bytes - left.bytes).slice(0, limit);
};

const runCommand = async (label: string, command: string[]) => {
    const startedAt = Date.now();
    const proc = Bun.spawn(command, {
        stdout: 'ignore',
        stderr: 'ignore',
    });
    const exitCode = await proc.exited;

    return {
        label,
        ok: exitCode === 0,
        exitCode,
        durationMs: Date.now() - startedAt,
    };
};

const readJson = async <T>(rootDir: string, ...segments: string[]) => {
    return (await Bun.file(join(rootDir, ...segments)).json()) as T;
};

type GenerateBaselineOptions = {
    rootDir?: string;
    commandStatuses?: CommandStatus[];
    runCommands?: boolean;
};

const readPackageScripts = async (rootDir: string) => {
    const packageJson = (await readJson<{ scripts?: Record<string, string> }>(rootDir, 'package.json').catch(() => ({
        scripts: {},
    }))) as { scripts?: Record<string, string> };
    return packageJson.scripts ?? {};
};

export const generateBaselineReport = async (options: GenerateBaselineOptions = {}): Promise<BaselineReport> => {
    const rootDir = options.rootDir ?? process.cwd();
    const commandStatuses =
        options.commandStatuses ??
        (options.runCommands === false
            ? []
            : [
                  await runCommand('lint', ['bun', 'run', 'lint']),
                  await runCommand('check', ['bun', 'run', 'check']),
                  await runCommand('test', ['bun', 'test']),
                  await runCommand('build', ['bun', 'run', 'build']),
                  await runCommand('bundle-check', ['bun', 'run', 'bundle-check']),
              ]);
    const scripts = await readPackageScripts(rootDir);

    const collections = await readJson<Array<Record<string, unknown>>>(
        rootDir,
        'src',
        'data',
        'collections.json',
    ).catch(() => []);
    const indexes = (await Bun.file(join(rootDir, 'src', 'data', 'indexes.json'))
        .json()
        .catch(() => ({}))) as Record<string, any>;
    const translators = (await Bun.file(join(rootDir, 'src', 'data', 'translators.json'))
        .json()
        .catch(() => [])) as Array<Record<string, unknown>>;

    const chunkStats = await walkDirectory(join(rootDir, 'tmp', 'excerpt-chunks'));
    const srcDataStats = await walkDirectory(join(rootDir, 'src', 'data'));
    const distStats = await walkDirectory(join(rootDir, 'dist'));
    const serverBundleStats = await walkDirectory(join(rootDir, 'dist', 'functions'));

    const sectionEntries = Object.entries(indexes.sectionToExcerpts ?? {}).flatMap(([collectionId, sections]) =>
        Object.entries(sections as Record<string, string[]>).map(([sectionId, excerptIds]) => {
            const chunkCount = (indexes.sectionToChunks?.[collectionId]?.[sectionId] ?? []).length;
            return {
                collectionId,
                sectionId,
                excerptCount: excerptIds.length,
                chunkCount,
            };
        }),
    );

    const topSectionFanOut = [...sectionEntries]
        .sort((left, right) => right.chunkCount - left.chunkCount || right.excerptCount - left.excerptCount)
        .slice(0, 10);

    const sectionChunkCounts = sectionEntries.map((entry) => entry.chunkCount);
    const collectionPageChunkCounts = Object.entries(indexes.collectionToSections ?? {}).flatMap(
        ([collectionId, sections]) => {
            const sectionToChunks = indexes.sectionToChunks?.[collectionId] ?? {};
            const sectionIds = sections as string[];
            const pageCounts: number[] = [];
            for (let index = 0; index < sectionIds.length; index += PAGE_SIZE) {
                const chunkReads = sectionIds
                    .slice(index, index + PAGE_SIZE)
                    .reduce(
                        (sum, sectionId) =>
                            sum + (((sectionToChunks as Record<string, string[]>)[sectionId] ?? []).length || 0),
                        0,
                    );
                pageCounts.push(chunkReads);
            }
            return pageCounts;
        },
    );

    return {
        generatedAt: new Date().toISOString(),
        collections: collections.length,
        translators: translators.length,
        srcData: srcDataStats,
        excerptChunks: chunkStats,
        buildOutput: distStats,
        serverBundle: {
            ...serverBundleStats,
            topFiles: await topFiles(join(rootDir, 'dist', 'functions')),
        },
        topSectionFanOut,
        routeReadFanOut: {
            excerptRoute: {
                chunkReads: summarizeValues(sectionEntries.map(() => 1)),
            },
            sectionRoute: {
                chunkReads: summarizeValues(sectionChunkCounts),
            },
            collectionRoute: {
                pageSize: PAGE_SIZE,
                chunkReads: summarizeValues(collectionPageChunkCounts),
            },
        },
        commands: commandStatuses,
        deployCoupling: {
            deployScript: scripts.deploy ?? null,
            usesPagesDeploy: (scripts.deploy ?? '').includes('wrangler pages deploy'),
            usesLegacyUploadR2: (scripts.deploy ?? '').includes('uploadR2.ts') || Boolean(scripts['upload-r2']),
            publishDatasetScript: scripts['publish-dataset'] ?? null,
        },
    };
};

const main = async () => {
    const baseline = await generateBaselineReport();

    await mkdir(dirname(BASELINE_OUTPUT_PATH), { recursive: true });
    await Bun.write(BASELINE_OUTPUT_PATH, JSON.stringify(baseline, null, 2));
    console.log(JSON.stringify(baseline, null, 2));

    if (baseline.commands.some((status) => !status.ok)) {
        process.exit(1);
    }
};

if (import.meta.main) {
    await main();
}
