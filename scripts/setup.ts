import { mkdir, readdir } from 'node:fs/promises';
import { format, join } from 'node:path';
import {
    doApiGet,
    getCollection,
    getEntity,
    getLibrary,
    init,
    type Translator as SDKTranslator,
} from '@ilmtest/ilmtest-sdk-js';
import type { BookData } from 'shamela';
import { slugify } from '@/lib/textUtils';
import type { Collection, Compilation, Excerpt, Heading } from '@/types/excerpts';
import pkg from '../package.json';
import {
    APP_MIN_DATASET_SCHEMA_VERSION,
    ARTIFACT_SCHEMA_VERSION,
    assertDatasetBuildMetadata,
    CHUNK_SCHEMA_VERSION,
    DATASET_SCHEMA_VERSION,
    type DatasetBuildMetadata,
    type DatasetSourceProvenance,
} from '../src/lib/datasetManifest';
import { chunkExcerpts } from './chunking';
import {
    HF_ASL_REVISION,
    HF_ASL_STORE,
    HF_EXCERPT_REVISION,
    HF_EXCERPT_STORE,
    HF_SHAMELA4_REVISION,
    HF_SHAMELA4_STORE,
    HF_TOKEN,
    ILMTEST_API_URL,
    OUTPUT_DIR,
} from './env';
import { downloadDataSet } from './huggingface';
import { addEntityMappings, generateIndexes, type LookupIndexes } from './indexing';
import { decompressJson } from './io';
import { mapHeadingIdToShamelaTitleId, mapTitlesToTableOfContents, type TitleNode } from './mapping';
import { type LoadedCompilation, normalizeQuranCompilation, type RawCompilation } from './quranCompilation';
import { buildRuntimeArtifacts, writeRuntimeArtifacts } from './runtimeArtifactsBuild';

const SHAMELA2_LIBRARY_ID = '1';
const SHAMELA4_LIBRARY_ID = '75';
const QURAN_LIBRARY_ID = '10';
const OUTPUT_DATA_DIR = 'src/data';
const CONTENT_CHUNKS_DIR = 'tmp/excerpt-chunks';
const DATASET_BUILD_DIR = 'tmp/dataset-build';
const RUNTIME_ARTIFACTS_DIR = 'tmp/runtime-artifacts';
const COLLECTIONS_FILE = 'collections.json';
const TRANSLATORS_FILE = 'translators.json';
const INDEXES_FILE = 'indexes.json';
const RUNTIME_BOOTSTRAP_FILE = 'runtime-bootstrap.json';
const DATASET_METADATA_FILE = 'metadata.json';

const getGitCommit = async () => {
    const proc = Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], {
        stdout: 'pipe',
        stderr: 'ignore',
    });
    const stdout = (await new Response(proc.stdout).text()).trim();

    if ((await proc.exited) === 0 && stdout) {
        return stdout;
    }

    return 'unknown';
};

const walkDirectoryBytes = async (dir: string): Promise<number> => {
    const entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true }).catch(() => null);
    if (!entries) {
        return 0;
    }
    let total = 0;
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            total += await walkDirectoryBytes(fullPath);
            continue;
        }

        total += Bun.file(fullPath).size;
    }

    return total;
};

const buildSourceProvenance = (): DatasetSourceProvenance[] => [
    {
        name: 'excerptStore',
        dataset: HF_EXCERPT_STORE,
        revision: HF_EXCERPT_REVISION,
    },
    {
        name: 'aslStore',
        dataset: HF_ASL_STORE,
        revision: HF_ASL_REVISION,
    },
    {
        name: 'shamelaStore',
        dataset: HF_SHAMELA4_STORE,
        revision: HF_SHAMELA4_REVISION,
    },
];

const downloadAndUnzipFile = async <T = unknown>({
    id,
    dataset,
    revision,
}: {
    id: string;
    dataset: string;
    revision: string;
}) => {
    const fileName = `${id}.json.br`;
    const buffer = await downloadDataSet(dataset, fileName, { authToken: HF_TOKEN, revision });
    console.log('Uncompressing...', fileName);
    return decompressJson<T>(buffer);
};

const loadCollection = async (id: string): Promise<Collection> => {
    console.log('Downloading collection...');
    const [collection] = await getCollection(parseInt(id, 10));
    const [library] = await getLibrary(collection.library!);
    library.url_template = library.url_template!.replace('{id}', collection.fid!).replace('{page}', ':page');

    const [entity] = collection.author ? await getEntity(collection.author) : [];
    const slug = slugify(collection.title!, entity?.display_name);

    return {
        authors: entity
            ? [
                  {
                      id: entity.id.toString(),
                      name: entity.display_name,
                      ism: entity.ar_display_name!,
                      img: entity.avatars!,
                  },
              ]
            : [],
        src: { id: collection.library!.toString(), fid: collection.fid! },
        roman: collection.display_name,
        slug,
        citationTemplate: library.url_template!,
        unwan: collection.ar_display_name!,
        id,
    };
};

const getDataSetPropsForCollection = (c: Collection) => {
    if (c.src.id === SHAMELA2_LIBRARY_ID || c.src.id === SHAMELA4_LIBRARY_ID) {
        return {
            dataset: HF_SHAMELA4_STORE,
            id: c.src.fid,
            revision: HF_SHAMELA4_REVISION,
        };
    }

    return {
        dataset: HF_ASL_STORE,
        id: c.id,
        revision: HF_ASL_REVISION,
    };
};

const loadExcerpts = async (collectionId: string): Promise<LoadedCompilation> => {
    const excerptsFile = format({ dir: OUTPUT_DIR, name: collectionId, ext: '.json' });

    if (await Bun.file(excerptsFile).exists()) {
        const localCompilation = (await Bun.file(excerptsFile).json()) as RawCompilation;
        const collection = localCompilation.collection ?? (await loadCollection(collectionId));

        if (collection.src.id === QURAN_LIBRARY_ID) {
            return normalizeQuranCompilation(localCompilation, collection);
        }

        return {
            data: {
                ...localCompilation,
                collection,
                sourceDocument: localCompilation.sourceDocument as Compilation['sourceDocument'],
                footnotes: localCompilation.footnotes ?? [],
            } as Compilation,
        };
    }

    console.log('Downloading excerpts from HuggingFace...');
    const excerpts = (await downloadAndUnzipFile({
        id: collectionId,
        dataset: HF_EXCERPT_STORE,
        revision: HF_EXCERPT_REVISION,
    })) as RawCompilation;

    console.log('Loading collection metadata...');
    const collection = await loadCollection(collectionId);
    excerpts.collection = collection;

    if (collection.src.id === QURAN_LIBRARY_ID) {
        const serialized = JSON.stringify(excerpts, null, 2);
        console.log('Saving', excerptsFile, serialized.length, 'bytes');
        await Bun.write(excerptsFile, serialized);
        return normalizeQuranCompilation(excerpts, collection);
    }

    console.log('Downloading asl from HuggingFace...');
    excerpts.sourceDocument = await downloadAndUnzipFile(getDataSetPropsForCollection(collection));

    const serialized = JSON.stringify(excerpts, null, 2);
    console.log('Saving', excerptsFile, serialized.length, 'bytes');
    await Bun.write(excerptsFile, serialized);

    return {
        data: {
            ...excerpts,
            collection,
            sourceDocument: excerpts.sourceDocument as Compilation['sourceDocument'],
            footnotes: excerpts.footnotes ?? [],
        } as Compilation,
    };
};

const loadTranslators = async (): Promise<SDKTranslator[]> => {
    const jsonFile = join(OUTPUT_DIR, 'translators.json');

    if (!(await Bun.file(jsonFile).exists())) {
        console.log('Downloading translators');
        const translators = (await doApiGet<SDKTranslator[]>('translators', { limit: -1 })).map((t) => ({
            id: t.id,
            name: t.name,
        }));
        await Bun.write(jsonFile, JSON.stringify(translators));
        return translators;
    }

    return Bun.file(jsonFile).json();
};

// ============================================================================
// Heading Range Computation (Migration Pattern)
// ============================================================================

type HeadingWithRange = Heading & {
    indexRange: { start: number; end: number };
    pageRange: { start: number; end: number };
    range: { start: string; end: string };
    parent?: string;
};

/**
 * Find the start index for a heading by page number
 */
function findHeadingStartIndex(from: number, pageMap: Map<number, number>): number | undefined {
    let startIndex = pageMap.get(from);

    // Fallback: If exact page has no content, try next few pages
    if (startIndex === undefined) {
        for (let p = from + 1; p <= from + 10; p++) {
            if (pageMap.has(p)) {
                startIndex = pageMap.get(p);
                break;
            }
        }
    }

    return startIndex;
}

/**
 * Calculate end index for a heading based on next headings
 * Following migration logic for parent/child relationships
 */
function calculateHeadingEndIndex(
    headingIndex: number,
    headings: Array<{ parent?: string; startIndex: number }>,
    contentLength: number,
): number {
    const current = headings[headingIndex];
    const isBook = !current.parent;
    let endIndex = contentLength - 1;

    for (let j = headingIndex + 1; j < headings.length; j++) {
        const next = headings[j];
        const nextIsBook = !next.parent;

        if (isBook && nextIsBook) {
            // A Book ends when the next Book starts
            endIndex = next.startIndex - 1;
            break;
        } else if (!isBook) {
            // A Chapter ends when the next Chapter OR next Book starts
            if (nextIsBook || next.startIndex > current.startIndex) {
                endIndex = next.startIndex - 1;
                break;
            }
        }
    }

    // Ensure valid range
    return Math.max(endIndex, current.startIndex);
}

/**
 * Compute ranges for Shamela headings
 * Maps title IDs to heading IDs, preserves parent relationships
 */
function computeShamelaHeadingRanges(
    titleTree: TitleNode[],
    headings: Heading[],
    excerpts: Excerpt[],
): HeadingWithRange[] {
    // Create map of title ID -> heading
    const titleIdToHeading = new Map<number, Heading>();
    for (const heading of headings) {
        const titleId = mapHeadingIdToShamelaTitleId(heading);
        titleIdToHeading.set(titleId, heading);
    }

    // Flatten title tree while preserving parent references
    const flatTitles: Array<{ titleId: number; parent?: number; page: number }> = [];

    const flatten = (nodes: TitleNode[], parentId?: number) => {
        for (const node of nodes) {
            // Only include titles that have headings
            if (titleIdToHeading.has(node.id)) {
                flatTitles.push({ titleId: node.id, parent: parentId, page: node.page });
            }
            if (node.children) {
                flatten(node.children, node.id);
            }
        }
    };

    flatten(titleTree);

    // Map page numbers to first excerpt index
    const pageMap = new Map<number, number>();
    excerpts.forEach((item, index) => {
        if (!pageMap.has(item.from)) {
            pageMap.set(item.from, index);
        }
    });

    // Determine start index for each heading
    const headingsWithIndex = flatTitles
        .map((t) => {
            const heading = titleIdToHeading.get(t.titleId)!;
            const startIndex = findHeadingStartIndex(heading.from, pageMap);

            if (startIndex === undefined) {
                return null;
            }

            // Map parent title ID to parent heading ID
            const parentHeadingId = t.parent ? titleIdToHeading.get(t.parent)?.id : undefined;

            return {
                ...heading,
                ...(parentHeadingId ? { parent: parentHeadingId } : {}),
                startIndex,
            };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);

    // Sort by index
    headingsWithIndex.sort((a, b) => a.startIndex - b.startIndex);

    // Calculate ranges
    return headingsWithIndex.map((h, i, arr) => {
        const startIndex = h.startIndex;
        const endIndex = calculateHeadingEndIndex(i, arr, excerpts.length);

        const startId = excerpts[startIndex].id;
        const endId = excerpts[endIndex].id;
        const startPage = excerpts[startIndex].from;
        const endPage = excerpts[endIndex].from;

        return {
            ...h,
            indexRange: { start: startIndex, end: endIndex },
            pageRange: { start: startPage, end: endPage },
            range: { start: startId, end: endId },
        };
    });
}

/**
 * Compute ranges for web scraped headings (simple page-based)
 */
function computeWebHeadingRanges(headings: Heading[], excerpts: Excerpt[]): HeadingWithRange[] {
    // Map page to excerpt indices
    const pageToIndices = new Map<number, number[]>();
    excerpts.forEach((e, idx) => {
        if (!pageToIndices.has(e.from)) {
            pageToIndices.set(e.from, []);
        }
        pageToIndices.get(e.from)!.push(idx);
    });

    return headings.map((heading) => {
        const indices = pageToIndices.get(heading.from) || [];

        if (indices.length === 0) {
            // No excerpts on this page - use page number as fallback
            return {
                ...heading,
                indexRange: { start: 0, end: 0 },
                pageRange: { start: heading.from, end: heading.from },
                range: { start: heading.id, end: heading.id },
            };
        }

        const startIndex = Math.min(...indices);
        const endIndex = Math.max(...indices);
        const startId = excerpts[startIndex].id;
        const endId = excerpts[endIndex].id;

        return {
            ...heading,
            indexRange: { start: startIndex, end: endIndex },
            pageRange: { start: heading.from, end: heading.from },
            range: { start: startId, end: endId },
        };
    });
}

const buildHeadingMarkers = (headings: Heading[]) => {
    const headingMarkers = new Map<string, Excerpt>();
    for (const heading of headings) {
        headingMarkers.set(heading.id, {
            id: heading.id,
            from: heading.from,
            nass: heading.nass,
            text: heading.text,
            translator: heading.translator,
            lastUpdatedAt: heading.lastUpdatedAt,
        });
    }

    return headingMarkers;
};

const buildSectionToExcerptsFromRanges = (
    headings: Heading[],
    headingsWithRanges: HeadingWithRange[],
    excerpts: Excerpt[],
) => {
    const sectionToExcerpts: Record<string, string[]> = {};
    const rangeByHeadingId = new Map(headingsWithRanges.map((heading) => [heading.id, heading]));

    for (const heading of headings) {
        const rangedHeading = rangeByHeadingId.get(heading.id);
        if (!rangedHeading?.indexRange) {
            sectionToExcerpts[heading.id] = [];
            continue;
        }

        const { start, end } = rangedHeading.indexRange;
        const slice = excerpts.slice(start, end + 1);
        sectionToExcerpts[heading.id] = slice.map((excerpt) => excerpt.id);
    }

    return sectionToExcerpts;
};

const backfillMissingTranslators = (items: Array<{ id: string; translator?: number }>, label: string) => {
    for (let i = 0; i < items.length; i++) {
        if (items[i].translator !== undefined) {
            continue;
        }

        const prevTranslator = i > 0 ? items[i - 1].translator : undefined;
        const nextTranslator = i + 1 < items.length ? items[i + 1].translator : undefined;
        const fallback = prevTranslator ?? nextTranslator;

        if (fallback !== undefined) {
            items[i].translator = fallback;
            console.warn(`⚠️  Missing translator for ${label} ${items[i].id}; backfilled with ${fallback}.`);
        } else {
            console.warn(`⚠️  Missing translator for ${label} ${items[i].id}; no adjacent value found. Using 0.`);
            items[i].translator = 0;
        }
    }
};

const writeSectionChunks = async (
    collectionId: string,
    data: Compilation,
    sectionToExcerpts: Record<string, string[]>,
    headingMarkers: Map<string, Excerpt>,
) => {
    const excerptById = new Map(data.excerpts.map((excerpt) => [excerpt.id, excerpt]));
    const sectionToChunks: Record<string, string[]> = {};
    const excerptToChunk: Record<string, string> = {};
    let chunkCount = 0;

    for (const [sectionId, excerptIds] of Object.entries(sectionToExcerpts)) {
        if (excerptIds.length === 0) {
            sectionToChunks[sectionId] = [];
            continue;
        }

        const sectionExcerpts = excerptIds
            .map((excerptId) => excerptById.get(excerptId))
            .filter((e): e is Excerpt => Boolean(e))
            .sort((a, b) => a.from - b.from);

        const headingMarker = headingMarkers.get(sectionId);
        if (headingMarker) {
            const existingIndex = sectionExcerpts.findIndex((excerpt) => excerpt.id === sectionId);
            if (existingIndex !== -1) {
                sectionExcerpts.splice(existingIndex, 1);
            }
            sectionExcerpts.unshift(headingMarker);
        }

        const chunks = chunkExcerpts(sectionExcerpts, sectionId);
        for (const chunk of chunks) {
            const safeSectionId = sectionId.replace(/[^a-zA-Z0-9]/g, '-');
            const chunkFileName = `chunk-${chunk.chunkIndex}.json`;
            const chunkId = `${collectionId}/${safeSectionId}/${chunkFileName}`;
            const sectionDir = join(CONTENT_CHUNKS_DIR, collectionId, safeSectionId);
            await mkdir(sectionDir, { recursive: true });
            const chunkPath = join(sectionDir, chunkFileName);
            await Bun.write(chunkPath, JSON.stringify(chunk));
            sectionToChunks[sectionId] ??= [];
            sectionToChunks[sectionId].push(chunkId);
            for (const excerptId of chunk.excerptIds) {
                excerptToChunk[excerptId] = chunkId;
            }
            chunkCount += 1;
        }
    }

    return { chunkCount, sectionToChunks, excerptToChunk };
};

// ============================================================================
// Main Setup
// ============================================================================
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestration flow is linear but lengthy
export const setup = async (...collectionIds: string[]) => {
    console.log('Starting setup\n');

    init('3', ILMTEST_API_URL!);
    const gitCommit = await getGitCommit();

    await Promise.all([
        mkdir(OUTPUT_DIR, { recursive: true }),
        mkdir(OUTPUT_DATA_DIR, { recursive: true }),
        mkdir(CONTENT_CHUNKS_DIR, { recursive: true }),
        mkdir(DATASET_BUILD_DIR, { recursive: true }),
        mkdir(RUNTIME_ARTIFACTS_DIR, { recursive: true }),
    ]);

    const allTranslators = await loadTranslators();
    const collections: Collection[] = [];
    const headingMarkersByCollection: Record<string, Map<string, Excerpt>> = {};
    let totalSections = 0;
    let totalExcerpts = 0;
    let totalChunks = 0;
    const indexes: LookupIndexes = {
        sectionToExcerpts: {},
        excerptToSection: {},
        pageToHeading: {},
        collectionToSections: {},
        sectionToChunks: {},
        excerptToChunk: {},
        entityToCollections: {},
    };

    for (const id of collectionIds) {
        console.log(`\n📚 Processing collection ${id}...`);
        const loaded = await loadExcerpts(id);
        const data = loaded.data;
        collections.push(data.collection);

        backfillMissingTranslators(data.excerpts, 'excerpt');
        backfillMissingTranslators(data.headings, 'heading');

        // Compute heading ranges based on source type
        let headingsWithRanges: HeadingWithRange[] = [];
        let topLevelHeadingIds: string[] = [];
        let sectionToExcerpts: Record<string, string[]> = {};
        let excerptToSection: Record<string, string> = {};
        let pageToHeading: Record<number, string> = {};

        if (data.collection.src.id === QURAN_LIBRARY_ID) {
            console.log("  Type: Qur'an");
            topLevelHeadingIds = data.headings.map((heading) => heading.id);
            sectionToExcerpts = loaded.explicitSectionToExcerpts ?? {};
            excerptToSection = loaded.explicitExcerptToSection ?? {};
            pageToHeading = Object.fromEntries(data.headings.map((heading) => [heading.from, heading.id]));
            console.log(`  ✓ ${Object.keys(sectionToExcerpts).length} headings with explicit excerpt mapping`);
        } else if ((data.sourceDocument as BookData)?.titles) {
            console.log('  Type: Shamela book');
            const titleTree = mapTitlesToTableOfContents((data.sourceDocument as BookData).titles);
            headingsWithRanges = computeShamelaHeadingRanges(titleTree, data.headings, data.excerpts);

            const rootTitleIds = new Set(titleTree.map((title) => title.id));
            topLevelHeadingIds = data.headings
                .filter((heading) => rootTitleIds.has(mapHeadingIdToShamelaTitleId(heading)))
                .map((heading) => heading.id);

            const partialIndexes = generateIndexes(data, id);
            sectionToExcerpts = buildSectionToExcerptsFromRanges(data.headings, headingsWithRanges, data.excerpts);
            excerptToSection = partialIndexes.excerptToSection?.[id] ?? {};
            pageToHeading = partialIndexes.pageToHeading?.[id] ?? {};
        } else {
            console.log('  Type: Web scraped');
            headingsWithRanges = computeWebHeadingRanges(data.headings, data.excerpts);
            topLevelHeadingIds = headingsWithRanges.filter((heading) => !heading.parent).map((heading) => heading.id);

            const partialIndexes = generateIndexes(data, id);
            sectionToExcerpts = buildSectionToExcerptsFromRanges(data.headings, headingsWithRanges, data.excerpts);
            excerptToSection = partialIndexes.excerptToSection?.[id] ?? {};
            pageToHeading = partialIndexes.pageToHeading?.[id] ?? {};
        }

        console.log(`  ✓ ${data.excerpts.length} excerpts`);
        if (data.collection.src.id !== QURAN_LIBRARY_ID) {
            console.log(`  ✓ ${headingsWithRanges.length} headings with ranges`);
        }
        totalExcerpts += data.excerpts.length;
        totalSections += data.headings.length;

        // Ensure heading IDs map to themselves (used for section title lookup)
        for (const heading of data.headings) {
            excerptToSection[heading.id] = heading.id;
        }
        indexes.sectionToExcerpts[id] = sectionToExcerpts;
        indexes.excerptToSection[id] = excerptToSection;
        indexes.pageToHeading[id] = pageToHeading;
        indexes.collectionToSections[id] = topLevelHeadingIds;

        const headingMarkers = buildHeadingMarkers(data.headings);
        headingMarkersByCollection[id] = headingMarkers;
        const chunkResult = await writeSectionChunks(id, data, sectionToExcerpts, headingMarkers);
        indexes.sectionToChunks[id] = chunkResult.sectionToChunks;
        indexes.excerptToChunk[id] = chunkResult.excerptToChunk;
        totalChunks += chunkResult.chunkCount;
        console.log(`  ✓ ${chunkResult.chunkCount} content chunks written to ${CONTENT_CHUNKS_DIR}`);
    }

    for (const collection of collections) {
        const authorIds = collection.authors.map((author) => author.id);
        if (authorIds.length > 0) {
            addEntityMappings(indexes, collection.id, authorIds);
        }
    }

    const collectionsPath = join(OUTPUT_DATA_DIR, COLLECTIONS_FILE);
    const translatorsPath = join(OUTPUT_DATA_DIR, TRANSLATORS_FILE);
    await Bun.write(translatorsPath, JSON.stringify(allTranslators, null, 2));
    console.log(`\n✓ Written ${translatorsPath}`);
    const indexesPath = join(OUTPUT_DATA_DIR, INDEXES_FILE);
    await Bun.write(indexesPath, JSON.stringify(indexes, null, 2));
    console.log(`✓ Written ${indexesPath}`);

    const generatedAt = new Date().toISOString();
    const routeBootstrapPath = join(OUTPUT_DATA_DIR, RUNTIME_BOOTSTRAP_FILE);
    const runtimeArtifacts = await buildRuntimeArtifacts({
        collections,
        indexes,
        chunksDir: CONTENT_CHUNKS_DIR,
        generatedAt,
        headingMarkersByCollection,
    });
    await writeRuntimeArtifacts(runtimeArtifacts, {
        collectionsFile: collectionsPath,
        routeBootstrapFile: routeBootstrapPath,
        runtimeArtifactsDir: RUNTIME_ARTIFACTS_DIR,
    });
    console.log(`✓ Written ${collectionsPath}`);
    console.log(`✓ Written ${routeBootstrapPath}`);

    const srcDataBytes =
        Bun.file(collectionsPath).size +
        Bun.file(translatorsPath).size +
        Bun.file(indexesPath).size +
        Bun.file(routeBootstrapPath).size;
    const chunkBytes = await walkDirectoryBytes(CONTENT_CHUNKS_DIR);
    const metadata: DatasetBuildMetadata = {
        generatedAt,
        gitCommit,
        schemaVersions: {
            datasetSchemaVersion: DATASET_SCHEMA_VERSION,
            chunkSchemaVersion: CHUNK_SCHEMA_VERSION,
            artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
            appMinDatasetSchemaVersion: APP_MIN_DATASET_SCHEMA_VERSION,
        },
        sourceProvenance: buildSourceProvenance(),
        toolVersions: {
            app: pkg.version,
            sdk: pkg.devDependencies['@ilmtest/ilmtest-sdk-js'] ?? 'unknown',
            bun: Bun.version,
            node: process.versions.node,
            wrangler: pkg.devDependencies.wrangler,
        },
        counts: {
            collections: collections.length,
            translators: allTranslators.length,
            sections: totalSections,
            excerpts: totalExcerpts,
            chunks: totalChunks,
        },
        bytes: {
            chunkBytes,
            srcDataBytes,
        },
        outputs: {
            collectionsFile: collectionsPath,
            translatorsFile: translatorsPath,
            indexesFile: indexesPath,
            chunksDir: CONTENT_CHUNKS_DIR,
            routeBootstrapFile: routeBootstrapPath,
            runtimeArtifactsDir: RUNTIME_ARTIFACTS_DIR,
        },
    };

    const metadataPath = join(DATASET_BUILD_DIR, DATASET_METADATA_FILE);
    assertDatasetBuildMetadata(metadata);
    await Bun.write(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`✓ Written ${metadataPath}`);

    console.log('\n✅ Setup complete!');
};

if (import.meta.main) {
    const collectionIds = process.argv.slice(2);
    if (collectionIds.length === 0) {
        console.error('Please provide one or more collection IDs. Example: bun run setup 1118 2576');
        process.exit(1);
    }
    await setup(...collectionIds);
}
