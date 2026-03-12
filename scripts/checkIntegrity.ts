import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { validateLocalDataset } from './datasetControl';
import { type ChunkPayload, listChunkKeys, loadLocalRuntimeData, readChunkFromDisk } from './runtimeData';

type IntegritySummary = {
    collections: number;
    sections: number;
    excerpts: number;
    chunks: number;
    generatedRoutes: number;
    curatedFilesChecked: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const listJsonFiles = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true }).catch(() => []);
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listJsonFiles(fullPath)));
            continue;
        }
        if (entry.name.endsWith('.json')) {
            files.push(fullPath);
        }
    }

    return files;
};

const assertKnownReference = (valid: boolean, kind: string, id: string, filePath: string) => {
    if (!valid) {
        throw new Error(`Curated metadata references unknown ${kind} "${id}" in ${filePath}`);
    }
};

const walkReferences = (
    value: unknown,
    validators: {
        collectionIds: Set<string>;
        sectionIds: Set<string>;
        excerptIds: Set<string>;
        entityIds: Set<string>;
    },
    filePath: string,
) => {
    if (Array.isArray(value)) {
        for (const entry of value) {
            walkReferences(entry, validators, filePath);
        }
        return;
    }

    if (!isRecord(value)) {
        return;
    }

    if ('collectionId' in value && typeof value.collectionId === 'string') {
        assertKnownReference(
            validators.collectionIds.has(value.collectionId),
            'collectionId',
            value.collectionId,
            filePath,
        );
    }
    if ('sectionId' in value && typeof value.sectionId === 'string') {
        assertKnownReference(validators.sectionIds.has(value.sectionId), 'sectionId', value.sectionId, filePath);
    }
    if ('excerptId' in value && typeof value.excerptId === 'string') {
        assertKnownReference(validators.excerptIds.has(value.excerptId), 'excerptId', value.excerptId, filePath);
    }

    const entityId =
        typeof value.entityId === 'string'
            ? value.entityId
            : typeof value.authorId === 'string'
              ? value.authorId
              : null;
    if (entityId) {
        assertKnownReference(validators.entityIds.has(entityId), 'entityId', entityId, filePath);
    }

    for (const child of Object.values(value)) {
        walkReferences(child, validators, filePath);
    }
};

const assertChunkContainsExcerpt = (chunk: ChunkPayload, excerptId: string, chunkKey: string) => {
    if (!chunk.excerpts.some((excerpt) => excerpt.id === excerptId)) {
        throw new Error(`Chunk ${chunkKey} does not contain excerpt ${excerptId}`);
    }
};

type IntegrityContext = {
    indexes: Awaited<ReturnType<typeof loadLocalRuntimeData>>['indexes'];
    chunksDir: string;
    availableChunkKeys: Set<string>;
    referencedChunkKeys: Set<string>;
    sectionIds: Set<string>;
    excerptIds: Set<string>;
    entityIds: Set<string>;
};

const validatePageHeadings = (collectionId: string, sections: string[], pageToHeading: Record<string, string>) => {
    for (const headingId of Object.values(pageToHeading)) {
        if (!sections.includes(headingId)) {
            throw new Error(`pageToHeading for collection ${collectionId} references unknown heading ${headingId}`);
        }
    }
};

const validateSectionIntegrity = async (collectionId: string, sectionId: string, context: IntegrityContext) => {
    context.sectionIds.add(sectionId);
    const sectionExcerpts = context.indexes.sectionToExcerpts[collectionId]?.[sectionId] ?? [];
    const sectionChunkIds = context.indexes.sectionToChunks[collectionId]?.[sectionId] ?? [];

    if (sectionChunkIds.length === 0) {
        throw new Error(`Section ${collectionId}/${sectionId} has no chunk mappings`);
    }
    if (sectionChunkIds.length > 8) {
        throw new Error(
            `Section ${collectionId}/${sectionId} exceeds the chunk fan-out cap with ${sectionChunkIds.length} chunks`,
        );
    }
    if (sectionChunkIds.length > 4) {
        console.warn(
            `⚠️  Section ${collectionId}/${sectionId} exceeds p95 fan-out target with ${sectionChunkIds.length} chunks.`,
        );
    }

    const firstChunkKey = sectionChunkIds[0];
    if (!context.availableChunkKeys.has(firstChunkKey)) {
        throw new Error(`First chunk ${firstChunkKey} for section ${collectionId}/${sectionId} is missing`);
    }

    const firstChunk = await readChunkFromDisk(context.chunksDir, firstChunkKey);
    if (!firstChunk.excerpts.some((excerpt) => excerpt.id === sectionId)) {
        throw new Error(`Section heading marker ${sectionId} is missing from chunk ${firstChunkKey}`);
    }

    for (const chunkKey of sectionChunkIds) {
        context.referencedChunkKeys.add(chunkKey);
        if (!context.availableChunkKeys.has(chunkKey)) {
            throw new Error(`Section ${collectionId}/${sectionId} references missing chunk ${chunkKey}`);
        }
    }

    for (const excerptId of sectionExcerpts) {
        context.excerptIds.add(excerptId);
        if (context.indexes.excerptToSection[collectionId]?.[excerptId] !== sectionId) {
            throw new Error(`Excerpt ${excerptId} does not point back to section ${sectionId}`);
        }

        const chunkKey = context.indexes.excerptToChunk[collectionId]?.[excerptId];
        if (!chunkKey) {
            throw new Error(`Excerpt ${excerptId} is missing an excerptToChunk mapping`);
        }
        context.referencedChunkKeys.add(chunkKey);
        if (!context.availableChunkKeys.has(chunkKey)) {
            throw new Error(`Excerpt ${excerptId} references missing chunk ${chunkKey}`);
        }

        const chunk = await readChunkFromDisk(context.chunksDir, chunkKey);
        assertChunkContainsExcerpt(chunk, excerptId, chunkKey);
    }

    return sectionExcerpts.length;
};

const validateCollectionIntegrity = async (
    collection: Awaited<ReturnType<typeof loadLocalRuntimeData>>['collections'][number],
    context: IntegrityContext,
) => {
    if (!collection.slug) {
        throw new Error(`Collection ${collection.id} is missing a slug`);
    }

    for (const author of collection.authors) {
        context.entityIds.add(author.id);
    }

    const sections = context.indexes.collectionToSections[collection.id] ?? [];
    let excerptRouteCount = 0;
    for (const sectionId of sections) {
        excerptRouteCount += await validateSectionIntegrity(collection.id, sectionId, context);
    }

    validatePageHeadings(collection.id, sections, context.indexes.pageToHeading[collection.id] ?? {});

    return {
        sectionCount: sections.length,
        excerptRouteCount,
    };
};

const validateCuratedFiles = async (
    curatedRoot: string,
    validators: {
        collectionIds: Set<string>;
        sectionIds: Set<string>;
        excerptIds: Set<string>;
        entityIds: Set<string>;
    },
) => {
    const curatedFiles = await listJsonFiles(curatedRoot);
    for (const filePath of curatedFiles) {
        walkReferences(await Bun.file(filePath).json(), validators, filePath);
    }
    return curatedFiles.length;
};

export const runIntegrityChecks = async (rootDir = '.') => {
    const { collections, indexes, paths } = await loadLocalRuntimeData(rootDir);
    await validateLocalDataset(paths.metadataPath);

    const context: IntegrityContext = {
        indexes,
        chunksDir: paths.chunksDir,
        availableChunkKeys: new Set(await listChunkKeys(paths.chunksDir)),
        referencedChunkKeys: new Set<string>(),
        sectionIds: new Set<string>(),
        excerptIds: new Set<string>(),
        entityIds: new Set<string>(),
    };
    const collectionIds = new Set(collections.map((collection) => collection.id));
    let generatedRoutes = collections.length + 2;

    for (const collection of collections) {
        const result = await validateCollectionIntegrity(collection, context);
        generatedRoutes += result.sectionCount + result.excerptRouteCount;
    }

    for (const chunkKey of context.availableChunkKeys) {
        if (!context.referencedChunkKeys.has(chunkKey)) {
            throw new Error(`Chunk ${chunkKey} exists on disk but is not referenced by indexes`);
        }
    }

    const curatedFilesChecked = await validateCuratedFiles(paths.curatedRoot, {
        collectionIds,
        sectionIds: context.sectionIds,
        excerptIds: context.excerptIds,
        entityIds: context.entityIds,
    });

    return {
        collections: collections.length,
        sections: context.sectionIds.size,
        excerpts: context.excerptIds.size,
        chunks: context.availableChunkKeys.size,
        generatedRoutes,
        curatedFilesChecked,
    } satisfies IntegritySummary;
};

const main = async () => {
    const result = await runIntegrityChecks(process.argv[2] || '.');
    console.log(JSON.stringify(result, null, 2));
};

if (import.meta.main) {
    await main();
}
