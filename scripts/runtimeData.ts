import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Collection, Excerpt } from '@/types/excerpts';
import type { LookupIndexes } from './indexing';

export type ChunkPayload = {
    sectionId: string;
    excerptIds: string[];
    excerpts: Excerpt[];
};

export type TranslatorRecord = {
    id: number;
    name: string;
};

export type LocalCorpusPaths = {
    rootDir: string;
    dataDir: string;
    chunksDir: string;
    buildDir: string;
    metadataPath: string;
    curatedRoot: string;
    routeBootstrapPath: string;
    runtimeArtifactsDir: string;
};

export type LocalRuntimeData = {
    collections: Collection[];
    translators: TranslatorRecord[];
    indexes: LookupIndexes;
    paths: LocalCorpusPaths;
};

const readJsonFile = async <T>(filePath: string) => {
    return (await Bun.file(filePath).json()) as T;
};

export const resolveLocalCorpusPaths = (rootDir = '.') => {
    const dataDir = join(rootDir, 'src', 'data');
    const buildDir = join(rootDir, 'tmp', 'dataset-build');

    return {
        rootDir,
        dataDir,
        chunksDir: join(rootDir, 'tmp', 'excerpt-chunks'),
        buildDir,
        metadataPath: join(buildDir, 'metadata.json'),
        curatedRoot: join(rootDir, 'src', 'data-curated'),
        routeBootstrapPath: join(dataDir, 'runtime-bootstrap.json'),
        runtimeArtifactsDir: join(rootDir, 'tmp', 'runtime-artifacts'),
    } satisfies LocalCorpusPaths;
};

const listFiles = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true }).catch(() => []);
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listFiles(fullPath)));
            continue;
        }
        files.push(fullPath);
    }

    return files;
};

export const normalizeChunkKey = (filePath: string, chunksDir: string) => {
    return relative(chunksDir, filePath).split(sep).join('/');
};

export const listChunkKeys = async (chunksDir: string) => {
    const files = await listFiles(chunksDir);
    return files
        .filter((filePath) => filePath.endsWith('.json'))
        .map((filePath) => normalizeChunkKey(filePath, chunksDir));
};

export const readChunkFromDisk = async (chunksDir: string, chunkKey: string) => {
    return readJsonFile<ChunkPayload>(join(chunksDir, chunkKey));
};

export const loadLocalRuntimeData = async (rootDir = '.') => {
    const paths = resolveLocalCorpusPaths(rootDir);
    const [collections, translators, indexes] = await Promise.all([
        readJsonFile<Collection[]>(join(paths.dataDir, 'collections.json')),
        readJsonFile<TranslatorRecord[]>(join(paths.dataDir, 'translators.json')),
        readJsonFile<LookupIndexes>(join(paths.dataDir, 'indexes.json')),
    ]);

    return {
        collections,
        translators,
        indexes,
        paths,
    } satisfies LocalRuntimeData;
};
