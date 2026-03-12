import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Collection, Entity, Excerpt } from '@/types/excerpts';
import pkg from '../package.json';
import {
    APP_MIN_DATASET_SCHEMA_VERSION,
    ARTIFACT_SCHEMA_VERSION,
    assertDatasetBuildMetadata,
    CHUNK_SCHEMA_VERSION,
    DATASET_SCHEMA_VERSION,
    type DatasetBuildMetadata,
} from '../src/lib/datasetManifest';
import type { LookupIndexes } from './indexing';
import {
    type ChunkPayload,
    type LocalCorpusPaths,
    resolveLocalCorpusPaths,
    type TranslatorRecord,
} from './runtimeData';
import { buildRuntimeArtifacts, writeRuntimeArtifacts } from './runtimeArtifactsBuild';

export type FixtureVariant = 'tiny' | 'medium';

type FixtureCollectionSpec = {
    id: string;
    fid: string;
    slug: string;
    roman: string;
    unwan: string;
    kind: 'shamela' | 'web';
    sectionCount: number;
    excerptsPerSection: number;
    chunkSize: number;
    author: Entity;
};

type FixtureSpec = {
    variant: FixtureVariant;
    description: string;
    translators: TranslatorRecord[];
    collections: FixtureCollectionSpec[];
};

type FixtureChunkFile = {
    key: string;
    payload: ChunkPayload;
};

type BuiltCollectionFixture = {
    collectionData: Collection;
    chunkFiles: FixtureChunkFile[];
    smokeRoutes: string[];
    counts: {
        sections: number;
        excerpts: number;
    };
    indexes: Pick<
        LookupIndexes,
        | 'sectionToExcerpts'
        | 'excerptToSection'
        | 'pageToHeading'
        | 'collectionToSections'
        | 'sectionToChunks'
        | 'excerptToChunk'
    >;
    entityMapping: LookupIndexes['entityToCollections'][string];
};

export type FixtureMaterializationResult = {
    variant: FixtureVariant;
    description: string;
    collections: number;
    sections: number;
    excerpts: number;
    chunks: number;
    paths: LocalCorpusPaths;
    smokeRoutes: string[];
};

type MaterializeFixtureOptions = {
    rootDir?: string;
    generatedAt?: string;
    gitCommit?: string;
};

const FIXTURE_SPEC_DIR = join('test', 'fixtures');

const getFixtureSpecPath = (variant: FixtureVariant) => join(FIXTURE_SPEC_DIR, variant, 'spec.json');

const readJsonFile = async <T>(filePath: string) => {
    return (await Bun.file(filePath).json()) as T;
};

const writeJsonFile = async (filePath: string, value: unknown) => {
    await Bun.write(filePath, JSON.stringify(value, null, 2));
};

const getGitCommit = async () => {
    const proc = Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], {
        stdout: 'pipe',
        stderr: 'ignore',
    });
    const stdout = (await new Response(proc.stdout).text()).trim();

    if ((await proc.exited) === 0 && stdout) {
        return stdout;
    }

    return 'fixture';
};

const clearDirectory = async (dir: string) => {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
};

const getCitationTemplate = (collection: FixtureCollectionSpec) => {
    if (collection.kind === 'web') {
        return `https://example.org/${collection.slug}/quran/:surah/:ayah?page=:page`;
    }

    return `https://shamela.example/books/${collection.fid}/:page`;
};

const makeSectionId = (collection: FixtureCollectionSpec, sectionIndex: number) => {
    const prefix = collection.kind === 'shamela' ? 'T' : 'W';
    return `${prefix}${sectionIndex.toString().padStart(4, '0')}`;
};

const buildHeading = (
    collection: FixtureCollectionSpec,
    sectionIndex: number,
    translatorId: number,
    page: number,
    lastUpdatedAt: number,
) => {
    const sectionId = makeSectionId(collection, sectionIndex);
    const tier = ((sectionIndex - 1) % 3) + 1;

    return {
        id: sectionId,
        from: page,
        nass: `العنوان ${sectionIndex} من ${collection.unwan}`,
        text: `Tier ${tier} Section ${sectionIndex} of ${collection.roman}`,
        translator: translatorId,
        lastUpdatedAt,
    } satisfies Excerpt;
};

const buildExcerptMeta = (collection: FixtureCollectionSpec, sectionIndex: number, excerptIndex: number) => {
    const cycle = (sectionIndex + excerptIndex) % 4;

    if (collection.kind === 'web') {
        if (cycle % 2 === 0) {
            return {
                url: `https://example.org/${collection.slug}/${sectionIndex}/${excerptIndex}`,
            };
        }

        return {
            surah: ((sectionIndex + excerptIndex) % 114) + 1,
            ayah: ((sectionIndex * 3 + excerptIndex) % 286) + 1,
            surahName: `Surah ${((sectionIndex + excerptIndex) % 114) + 1}`,
        };
    }

    if (cycle === 0 || cycle === 3) {
        return { num: `${sectionIndex}${excerptIndex}` };
    }

    return {
        vol: ((sectionIndex - 1) % 5) + 1,
        vp: ((sectionIndex - 1) * collection.excerptsPerSection + excerptIndex) % 400,
    };
};

const buildExcerpt = (
    collection: FixtureCollectionSpec,
    sectionIndex: number,
    excerptIndex: number,
    translatorId: number,
    page: number,
    lastUpdatedAt: number,
) => {
    const sectionId = makeSectionId(collection, sectionIndex);
    const excerptId = `${sectionId}-E${excerptIndex.toString().padStart(3, '0')}`;

    return {
        id: excerptId,
        from: page,
        nass: `النص العربي ${excerptIndex} من القسم ${sectionIndex} في ${collection.unwan}`,
        text: `Excerpt ${excerptIndex} from section ${sectionIndex} of ${collection.roman}.\n\n- Verified citation path\n- Bilingual fixture content`,
        translator: translatorId,
        lastUpdatedAt,
        meta: buildExcerptMeta(collection, sectionIndex, excerptIndex),
    } satisfies Excerpt;
};

const createChunkPayloads = (
    collection: FixtureCollectionSpec,
    heading: Excerpt,
    excerpts: Excerpt[],
): FixtureChunkFile[] => {
    const sectionId = heading.id;
    const chunks: FixtureChunkFile[] = [];
    let cursor = 0;
    let chunkIndex = 0;

    while (cursor < excerpts.length) {
        const excerptSlice = excerpts.slice(cursor, cursor + collection.chunkSize);
        const chunkExcerpts = chunkIndex === 0 ? [heading, ...excerptSlice] : excerptSlice;
        const chunkKey = `${collection.id}/${sectionId}/chunk-${chunkIndex}.json`;
        chunks.push({
            key: chunkKey,
            payload: {
                sectionId,
                excerptIds: chunkExcerpts.map((excerpt) => excerpt.id),
                excerpts: chunkExcerpts,
            },
        });
        cursor += collection.chunkSize;
        chunkIndex += 1;
    }

    return chunks;
};

const buildCollectionFixture = (
    collection: FixtureCollectionSpec,
    translators: TranslatorRecord[],
): BuiltCollectionFixture => {
    const collectionData: Collection = {
        id: collection.id,
        slug: collection.slug,
        roman: collection.roman,
        unwan: collection.unwan,
        authors: [collection.author],
        src: {
            id: collection.kind === 'shamela' ? '75' : 'web',
            fid: collection.fid,
        },
        citationTemplate: getCitationTemplate(collection),
    };
    const localIndexes: BuiltCollectionFixture['indexes'] = {
        sectionToExcerpts: { [collection.id]: {} },
        excerptToSection: { [collection.id]: {} },
        pageToHeading: { [collection.id]: {} },
        collectionToSections: { [collection.id]: [] },
        sectionToChunks: { [collection.id]: {} },
        excerptToChunk: { [collection.id]: {} },
    };
    const chunkFiles: FixtureChunkFile[] = [];
    const smokeRoutes: string[] = [];
    let totalExcerpts = 0;

    for (let sectionIndex = 1; sectionIndex <= collection.sectionCount; sectionIndex += 1) {
        const translatorId = translators[(sectionIndex - 1) % translators.length]?.id ?? translators[0].id;
        const sectionId = makeSectionId(collection, sectionIndex);
        const pageBase = sectionIndex * 10;
        const heading = buildHeading(collection, sectionIndex, translatorId, pageBase, sectionIndex * 100);
        const excerpts = Array.from({ length: collection.excerptsPerSection }, (_, excerptOffset) =>
            buildExcerpt(
                collection,
                sectionIndex,
                excerptOffset + 1,
                translators[(sectionIndex + excerptOffset) % translators.length]?.id ?? translatorId,
                pageBase + excerptOffset + 1,
                sectionIndex * 100 + excerptOffset + 1,
            ),
        );
        const chunks = createChunkPayloads(collection, heading, excerpts);

        localIndexes.collectionToSections[collection.id].push(sectionId);
        localIndexes.pageToHeading[collection.id][pageBase] = sectionId;
        localIndexes.sectionToExcerpts[collection.id][sectionId] = excerpts.map((excerpt) => excerpt.id);
        localIndexes.sectionToChunks[collection.id][sectionId] = chunks.map((chunk) => chunk.key);

        for (const excerpt of excerpts) {
            localIndexes.excerptToSection[collection.id][excerpt.id] = sectionId;
        }

        for (const chunk of chunks) {
            chunkFiles.push(chunk);
            for (const excerpt of chunk.payload.excerpts) {
                if (excerpt.id === sectionId) {
                    continue;
                }
                localIndexes.excerptToChunk[collection.id][excerpt.id] = chunk.key;
            }
        }

        if (sectionIndex === 1) {
            smokeRoutes.push(
                `/browse/${collection.slug}`,
                `/browse/${collection.slug}/${sectionId}`,
                `/browse/${collection.slug}/${sectionId}/e/${excerpts[0].id}`,
            );
        }

        totalExcerpts += excerpts.length;
    }

    return {
        collectionData,
        chunkFiles,
        smokeRoutes,
        counts: {
            sections: collection.sectionCount,
            excerpts: totalExcerpts,
        },
        indexes: localIndexes,
        entityMapping: {
            authorOf: [collection.id],
        },
    };
};

const mergeCollectionFixture = (indexes: LookupIndexes, built: BuiltCollectionFixture, authorId: string) => {
    Object.assign(indexes.sectionToExcerpts, built.indexes.sectionToExcerpts);
    Object.assign(indexes.excerptToSection, built.indexes.excerptToSection);
    Object.assign(indexes.pageToHeading, built.indexes.pageToHeading);
    Object.assign(indexes.collectionToSections, built.indexes.collectionToSections);
    Object.assign(indexes.sectionToChunks, built.indexes.sectionToChunks);
    Object.assign(indexes.excerptToChunk, built.indexes.excerptToChunk);
    indexes.entityToCollections[authorId] = built.entityMapping;
};

const buildFixtureCorpus = (spec: FixtureSpec, generatedAt: string, gitCommit: string, paths: LocalCorpusPaths) => {
    const collections: Collection[] = [];
    const indexes: LookupIndexes = {
        sectionToExcerpts: {},
        excerptToSection: {},
        pageToHeading: {},
        collectionToSections: {},
        sectionToChunks: {},
        excerptToChunk: {},
        entityToCollections: {},
    };
    const chunkFiles: FixtureChunkFile[] = [];
    const smokeRoutes = ['/', '/browse'];
    let totalSections = 0;
    let totalExcerpts = 0;

    for (const collection of spec.collections) {
        const built = buildCollectionFixture(collection, spec.translators);
        collections.push(built.collectionData);
        chunkFiles.push(...built.chunkFiles);
        smokeRoutes.push(...built.smokeRoutes);
        totalSections += built.counts.sections;
        totalExcerpts += built.counts.excerpts;
        mergeCollectionFixture(indexes, built, collection.author.id);
    }

    return {
        collections,
        translators: spec.translators,
        indexes,
        chunkFiles,
        smokeRoutes,
        description: spec.description,
        counts: {
            collections: collections.length,
            translators: spec.translators.length,
            sections: totalSections,
            excerpts: totalExcerpts,
            chunks: chunkFiles.length,
        },
    };
};

const textSize = (value: string) => new TextEncoder().encode(value).byteLength;

export const loadFixtureSpec = async (variant: FixtureVariant) => {
    const spec = await readJsonFile<FixtureSpec>(getFixtureSpecPath(variant));
    if (spec.variant !== variant) {
        throw new Error(`Fixture spec mismatch: expected ${variant} but found ${spec.variant}`);
    }
    return spec;
};

export const materializeFixture = async (variant: FixtureVariant, options: MaterializeFixtureOptions = {}) => {
    const spec = await loadFixtureSpec(variant);
    const paths = resolveLocalCorpusPaths(options.rootDir);
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const gitCommit = options.gitCommit ?? (await getGitCommit());
    const corpus = buildFixtureCorpus(spec, generatedAt, gitCommit, paths);

    await Promise.all([
        clearDirectory(paths.dataDir),
        clearDirectory(paths.chunksDir),
        clearDirectory(paths.buildDir),
        clearDirectory(paths.runtimeArtifactsDir),
    ]);

    await Promise.all([
        mkdir(join(paths.curatedRoot, 'entities'), { recursive: true }),
        mkdir(join(paths.curatedRoot, 'relations'), { recursive: true }),
        mkdir(join(paths.curatedRoot, 'taxonomy'), { recursive: true }),
        mkdir(join(paths.curatedRoot, 'corrections'), { recursive: true }),
    ]);

    const curatedDirs = await readdir(paths.curatedRoot, { withFileTypes: true }).catch(() => []);
    if (curatedDirs.length === 0) {
        throw new Error(`Failed to create curated data directories at ${paths.curatedRoot}`);
    }

    await Promise.all([
        writeJsonFile(join(paths.dataDir, 'translators.json'), corpus.translators),
        writeJsonFile(join(paths.dataDir, 'indexes.json'), corpus.indexes),
        ...corpus.chunkFiles.map(async (chunk) => {
            await mkdir(dirname(join(paths.chunksDir, chunk.key)), { recursive: true });
            await writeJsonFile(join(paths.chunksDir, chunk.key), chunk.payload);
        }),
        Bun.write(join(paths.curatedRoot, 'entities', '.gitkeep'), ''),
        Bun.write(join(paths.curatedRoot, 'relations', '.gitkeep'), ''),
        Bun.write(join(paths.curatedRoot, 'taxonomy', '.gitkeep'), ''),
        Bun.write(join(paths.curatedRoot, 'corrections', '.gitkeep'), ''),
    ]);

    const runtimeArtifacts = await buildRuntimeArtifacts({
        collections: corpus.collections,
        indexes: corpus.indexes,
        chunksDir: paths.chunksDir,
        generatedAt,
    });
    await writeRuntimeArtifacts(runtimeArtifacts, {
        collectionsFile: join(paths.dataDir, 'collections.json'),
        routeBootstrapFile: paths.routeBootstrapPath,
        runtimeArtifactsDir: paths.runtimeArtifactsDir,
    });

    const srcDataBytes =
        Bun.file(join(paths.dataDir, 'collections.json')).size +
        Bun.file(join(paths.dataDir, 'translators.json')).size +
        Bun.file(join(paths.dataDir, 'indexes.json')).size +
        Bun.file(paths.routeBootstrapPath).size;
    const chunkBytes = corpus.chunkFiles.reduce((total, chunk) => total + textSize(JSON.stringify(chunk.payload)), 0);
    const metadata = assertDatasetBuildMetadata({
        generatedAt,
        gitCommit,
        schemaVersions: {
            datasetSchemaVersion: DATASET_SCHEMA_VERSION,
            chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
            artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
            appMinDatasetSchemaVersion: APP_MIN_DATASET_SCHEMA_VERSION,
        },
        sourceProvenance: [
            {
                name: 'excerptStore',
                dataset: `fixtures/${spec.variant}/excerpt-store`,
                revision: 'fixture-v1',
            },
            {
                name: 'aslStore',
                dataset: `fixtures/${spec.variant}/asl-store`,
                revision: 'fixture-v1',
            },
            {
                name: 'shamelaStore',
                dataset: `fixtures/${spec.variant}/shamela-store`,
                revision: 'fixture-v1',
            },
        ],
        toolVersions: {
            app: pkg.version,
            sdk: String(pkg.devDependencies['@ilmtest/ilmtest-sdk-js']),
            bun: Bun.version,
            node: process.versions.node,
            wrangler: String(pkg.devDependencies.wrangler),
        },
        counts: corpus.counts,
        bytes: {
            chunkBytes,
            srcDataBytes,
        },
        outputs: {
            collectionsFile: join(paths.dataDir, 'collections.json'),
            translatorsFile: join(paths.dataDir, 'translators.json'),
            indexesFile: join(paths.dataDir, 'indexes.json'),
            chunksDir: paths.chunksDir,
            routeBootstrapFile: paths.routeBootstrapPath,
            runtimeArtifactsDir: paths.runtimeArtifactsDir,
        },
    });
    await writeJsonFile(paths.metadataPath, metadata);

    return {
        variant,
        description: corpus.description,
        collections: corpus.collections.length,
        sections: corpus.counts.sections,
        excerpts: corpus.counts.excerpts,
        chunks: corpus.counts.chunks,
        paths,
        smokeRoutes: corpus.smokeRoutes,
    } satisfies FixtureMaterializationResult;
};
