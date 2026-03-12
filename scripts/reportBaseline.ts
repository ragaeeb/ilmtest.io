import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BASELINE_OUTPUT_PATH = join('docs', 'baselines', 'current.json');
const PAGE_SIZE = 100;

type DirectoryStats = {
    files: number;
    bytes: number;
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

const main = async () => {
    const commandStatuses = [
        await runCommand('lint', ['bun', 'run', 'lint']),
        await runCommand('check', ['bun', 'run', 'check']),
        await runCommand('test', ['bun', 'test']),
        await runCommand('build', ['bun', 'run', 'build']),
        await runCommand('bundle-check', ['bun', 'run', 'bundle-check']),
    ];

    const collections = (await Bun.file(join('src', 'data', 'collections.json'))
        .json()
        .catch(() => [])) as Array<Record<string, unknown>>;
    const indexes = (await Bun.file(join('src', 'data', 'indexes.json'))
        .json()
        .catch(() => ({}))) as Record<string, any>;
    const translators = (await Bun.file(join('src', 'data', 'translators.json'))
        .json()
        .catch(() => [])) as Array<Record<string, unknown>>;

    const chunkStats = await walkDirectory(join('tmp', 'excerpt-chunks'));
    const srcDataStats = {
        files: 3,
        bytes:
            Bun.file(join('src', 'data', 'collections.json')).size +
            Bun.file(join('src', 'data', 'translators.json')).size +
            Bun.file(join('src', 'data', 'indexes.json')).size,
    };
    const distStats = await walkDirectory('dist');
    const serverBundleStats = await walkDirectory(join('dist', 'functions'));

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

    const baseline = {
        generatedAt: new Date().toISOString(),
        collections: collections.length,
        translators: translators.length,
        srcData: srcDataStats,
        excerptChunks: chunkStats,
        buildOutput: distStats,
        serverBundle: {
            ...serverBundleStats,
            topFiles: await topFiles(join('dist', 'functions')),
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
    };

    await mkdir(dirname(BASELINE_OUTPUT_PATH), { recursive: true });
    await Bun.write(BASELINE_OUTPUT_PATH, JSON.stringify(baseline, null, 2));
    console.log(JSON.stringify(baseline, null, 2));

    if (commandStatuses.some((status) => !status.ok)) {
        process.exit(1);
    }
};

await main();
