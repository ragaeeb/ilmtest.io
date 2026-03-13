import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIST_DIR = join(process.cwd(), 'dist');
const FUNCTION_DIR = join(DIST_DIR, 'functions');
const WORKER_DIR = join(DIST_DIR, '_worker.js');

const INDEX_SIGNATURES = [
    '"sectionToExcerpts"',
    '"excerptToSection"',
    '"collectionToSections"',
    '"sectionToChunks"',
    '"excerptToChunk"',
    '"pageToHeading"',
];

const scanPath = async (targetPath: string): Promise<string[]> => {
    const metadata = await stat(targetPath).catch(() => null);
    if (!metadata) {
        return [];
    }
    if (!metadata.isDirectory()) {
        return [targetPath];
    }

    const entries = await readdir(targetPath, { encoding: 'utf8', withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(targetPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await scanPath(fullPath)));
            continue;
        }
        files.push(fullPath);
    }
    return files;
};

const readTextIfJs = async (filePath: string) => {
    if (!filePath.endsWith('.js') && !filePath.endsWith('.mjs') && !filePath.endsWith('.cjs')) {
        return null;
    }
    return await Bun.file(filePath).text();
};

const main = async () => {
    const distEntries = await readdir(DIST_DIR, { encoding: 'utf8', withFileTypes: true }).catch(() => null);
    if (!distEntries) {
        throw new Error('Missing dist output. Run `bun run build` before bundle checks.');
    }

    const allFiles = [...(await scanPath(FUNCTION_DIR)), ...(await scanPath(WORKER_DIR))];

    const offendingFiles: string[] = [];
    for (const filePath of allFiles) {
        const text = await readTextIfJs(filePath);
        if (!text) {
            continue;
        }
        if (INDEX_SIGNATURES.some((signature) => text.includes(signature))) {
            offendingFiles.push(filePath);
        }
    }

    const filenameHits = allFiles.filter(
        (filePath) => filePath.includes('indexes.json') || filePath.includes('indexes.full.json'),
    );

    if (offendingFiles.length > 0 || filenameHits.length > 0) {
        const details = [
            offendingFiles.length > 0 ? `Found index signatures in:\n- ${offendingFiles.join('\n- ')}` : null,
            filenameHits.length > 0 ? `Found index files in:\n- ${filenameHits.join('\n- ')}` : null,
        ]
            .filter(Boolean)
            .join('\n\n');
        throw new Error(`Server bundle includes indexes content.\n\n${details}`);
    }

    const stats = await Promise.all(
        allFiles.map(async (filePath) => ({
            path: filePath,
            size: (await stat(filePath)).size,
        })),
    );
    const totalBytes = stats.reduce((sum, item) => sum + item.size, 0);

    console.log(
        JSON.stringify(
            {
                checkedFiles: allFiles.length,
                totalBytes,
                status: 'ok',
            },
            null,
            2,
        ),
    );
};

await main();
