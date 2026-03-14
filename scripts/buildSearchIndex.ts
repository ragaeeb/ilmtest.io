/**
 * M5 Search MVP — Build-time Pagefind index generator
 *
 * This script reads the local corpus data (collections, indexes, chunks) and
 * generates a Pagefind search index using the Node API with custom records.
 *
 * Pagefind CLI is NOT used to crawl HTML (excerpt pages are SSR).
 * Instead, each excerpt is registered as a custom record with:
 *   - canonical URL
 *   - Arabic text + translation text as searchable content
 *   - collection and section metadata as filters
 *   - lightweight display metadata for result rendering
 *
 * Usage:
 *   bun scripts/buildSearchIndex.ts [--output dist/client/pagefind]
 */
import { mkdir } from 'node:fs/promises';
import type { Collection, Excerpt } from '@/types/excerpts';
import { type ChunkPayload, type LocalRuntimeData, loadLocalRuntimeData, readChunkFromDisk } from './runtimeData';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchRecord = {
    url: string;
    content: string;
    language: string;
    meta: {
        title: string;
        collectionTitle: string;
        collectionSlug: string;
        sectionTitle: string;
        authorName: string;
    };
    filters: {
        collection: string[];
        language: string[];
        section: string[];
    };
    sort: {
        /** Stringified page number for numeric sorting */
        page: string;
    };
};

export type SearchIndexStats = {
    totalRecords: number;
    totalExcerpts: number;
    totalCollections: number;
    byCollection: Record<string, number>;
    durationMs: number;
};

type BuildSearchIndexOptions = {
    maxChars?: number;
    maxRecords?: number;
    collections?: string[];
    logEvery?: number;
    pagefind?: PagefindModule;
};

type ResolvedIndexOptions = {
    maxChars: number;
    maxRecords?: number;
    logEvery: number;
    collectionFilter?: Set<string>;
};

type PagefindIndex = {
    addCustomRecord: (record: SearchRecord) => Promise<{ errors?: string[] }>;
    writeFiles: (options: { outputPath: string }) => Promise<{ errors?: string[] }>;
};

type PagefindModule = {
    createIndex: (options: { forceLanguage?: string }) => Promise<{ index?: PagefindIndex | null; errors?: string[] }>;
    close: () => Promise<undefined | null>;
};

// ---------------------------------------------------------------------------
// Record building (pure, testable)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHARS = 4000;

/**
 * Truncate long text for search content to keep index sizes reasonable.
 * Pagefind indexes the text for search internally; we don't need the full
 * multi-page nass if it's enormous.
 */
const truncateForIndex = (text: string, maxChars: number): string => {
    if (text.length <= maxChars) {
        return text;
    }

    return `${text.slice(0, maxChars)}…`;
};

/**
 * Build a combined search content string from an excerpt.
 * Arabic text is placed first, then a separator, then the translation.
 */
const buildSearchContent = (excerpt: Excerpt, maxChars: number): string => {
    const parts: string[] = [];

    if (excerpt.nass?.trim()) {
        parts.push(truncateForIndex(excerpt.nass.trim(), maxChars));
    }

    if (excerpt.text?.trim()) {
        parts.push(truncateForIndex(excerpt.text.trim(), maxChars));
    }

    return parts.join('\n\n---\n\n');
};

/**
 * Detect the primary language of an excerpt for Pagefind language indexing.
 * Since the corpus is bilingual, we index each excerpt primarily under 'ar'
 * if it has Arabic text, and also create a parallel English record.
 */
const detectLanguages = (excerpt: Excerpt): string[] => {
    const langs: string[] = [];

    if (excerpt.nass?.trim()) {
        langs.push('ar');
    }

    if (excerpt.text?.trim()) {
        langs.push('en');
    }

    return langs.length > 0 ? langs : ['ar'];
};

/**
 * Build a display title for a search result from available context.
 */
const buildResultTitle = (sectionTitle: string, collection: Collection, excerpt: Excerpt): string => {
    const authorName = collection.authors?.[0]?.name ?? '';
    const preview = excerpt.text?.trim()?.slice(0, 80) ?? excerpt.nass?.trim()?.slice(0, 80) ?? '';
    const suffix = preview.length >= 80 ? '…' : '';

    if (sectionTitle && sectionTitle !== `Section ${excerpt.id}`) {
        return `${sectionTitle} — ${authorName}`;
    }

    return `${preview}${suffix}`;
};

const SECTION_FILTER_SEPARATOR = '::';

const encodeFilterSegment = (value: string) => encodeURIComponent(value);

const buildSectionFilterValue = (collectionSlug: string, sectionId: string, sectionTitle: string) => {
    const safeTitle = sectionTitle?.trim() || sectionId;
    return [collectionSlug, sectionId, safeTitle].map(encodeFilterSegment).join(SECTION_FILTER_SEPARATOR);
};

type ExcerptRecordContext = {
    excerpt: Excerpt;
    collection: Collection;
    sectionId: string;
    sectionTitle: string;
};

/**
 * Build a Pagefind custom record from an excerpt.
 *
 * Exported for unit testing.
 */
export const buildSearchRecord = (ctx: ExcerptRecordContext): SearchRecord => {
    const maxChars = DEFAULT_MAX_CHARS;
    return buildSearchRecordWithOptions(ctx, { maxChars });
};

type BuildSearchRecordOptions = {
    maxChars: number;
};

const buildSearchRecordWithOptions = (ctx: ExcerptRecordContext, options: BuildSearchRecordOptions): SearchRecord => {
    const { excerpt, collection, sectionId, sectionTitle } = ctx;

    const url = `/browse/${collection.slug}/${sectionId}/e/${excerpt.id}`;
    const content = buildSearchContent(excerpt, options.maxChars);
    const languages = detectLanguages(excerpt);
    const authorName = collection.authors?.[0]?.name ?? '';
    const sectionFilterValue = buildSectionFilterValue(collection.slug, sectionId, sectionTitle);

    return {
        url,
        content,
        language: languages.includes('ar') ? 'ar' : 'en',
        meta: {
            title: buildResultTitle(sectionTitle, collection, excerpt),
            collectionTitle: collection.unwan || collection.roman,
            collectionSlug: collection.slug,
            sectionTitle,
            authorName,
        },
        filters: {
            collection: [collection.slug],
            language: languages,
            section: [sectionFilterValue],
        },
        sort: {
            page: String(excerpt.from),
        },
    };
};

// ---------------------------------------------------------------------------
// Corpus iteration helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the section title for an excerpt by walking the chunk list for that
 * section and finding the heading marker (the excerpt whose id == sectionId).
 */
const resolveSectionTitle = (chunks: ChunkPayload[], sectionId: string): string => {
    for (const chunk of chunks) {
        const heading = chunk.excerpts.find((e) => e.id === sectionId);
        if (heading) {
            return heading.text?.trim() || heading.nass?.trim() || `Section ${sectionId}`;
        }
    }

    return `Section ${sectionId}`;
};

type ExcerptWithContext = ExcerptRecordContext;

/**
 * Iterate over the corpus and yield excerpt contexts suitable for record
 * building. This reads chunks sequentially per collection to keep memory
 * usage bounded.
 */
const yieldSectionExcerpts = async function* (
    chunksDir: string,
    chunkKeys: string[],
    collection: Collection,
    sectionId: string,
): AsyncGenerator<ExcerptWithContext> {
    // Load all chunks for this section to resolve heading title
    const chunks: ChunkPayload[] = [];
    for (const chunkKey of chunkKeys) {
        chunks.push(await readChunkFromDisk(chunksDir, chunkKey));
    }

    const sectionTitle = resolveSectionTitle(chunks, sectionId);

    // Yield each non-heading excerpt
    for (const chunk of chunks) {
        for (const excerpt of chunk.excerpts) {
            // Skip the heading marker itself — it's not user-facing content
            if (excerpt.id === sectionId) {
                continue;
            }

            yield {
                excerpt,
                collection,
                sectionId,
                sectionTitle,
            };
        }
    }
};

/**
 * Iterate over the corpus and yield excerpt contexts suitable for record
 * building. This reads chunks sequentially per collection to keep memory
 * usage bounded.
 */
export const iterateCorpusExcerpts = async function* (
    data: LocalRuntimeData,
    collectionFilter?: Set<string>,
): AsyncGenerator<ExcerptWithContext> {
    const chunksDir = data.paths.chunksDir;
    const indexes = data.indexes;

    for (const collection of data.collections) {
        if (collectionFilter && !collectionFilter.has(collection.id) && !collectionFilter.has(collection.slug)) {
            continue;
        }

        const sectionIds = indexes.collectionToSections[collection.id] ?? [];

        for (const sectionId of sectionIds) {
            const chunkKeys = indexes.sectionToChunks[collection.id]?.[sectionId] ?? [];
            if (chunkKeys.length === 0) {
                continue;
            }

            yield* yieldSectionExcerpts(chunksDir, chunkKeys, collection, sectionId);
        }
    }
};

// ---------------------------------------------------------------------------
// Pagefind index builder
// ---------------------------------------------------------------------------

const resolveIndexOptions = (options: BuildSearchIndexOptions): ResolvedIndexOptions => {
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    const logEvery = options.logEvery ?? 1000;
    const collectionFilter = options.collections?.length
        ? new Set(options.collections.map((value) => value.trim()).filter(Boolean))
        : undefined;

    return {
        maxChars,
        maxRecords: options.maxRecords,
        logEvery,
        collectionFilter,
    };
};

const indexCorpusRecords = async (
    index: { addCustomRecord: (record: SearchRecord) => Promise<{ errors?: string[] }> },
    data: LocalRuntimeData,
    options: ResolvedIndexOptions,
) => {
    let recordCount = 0;
    const byCollection: Record<string, number> = {};

    for await (const ctx of iterateCorpusExcerpts(data, options.collectionFilter)) {
        const record = buildSearchRecordWithOptions(ctx, { maxChars: options.maxChars });

        const { errors } = await index.addCustomRecord(record);

        if (errors && errors.length > 0) {
            console.warn(`   ⚠ Error indexing ${record.url}:`, errors);
            continue;
        }

        recordCount++;
        byCollection[ctx.collection.slug] = (byCollection[ctx.collection.slug] ?? 0) + 1;

        if (recordCount % options.logEvery === 0) {
            console.log(`   … indexed ${recordCount} records`);
        }

        if (options.maxRecords && recordCount >= options.maxRecords) {
            console.log(`   … reached max-records=${options.maxRecords}, stopping early`);
            break;
        }
    }

    return { recordCount, byCollection };
};

export const buildSearchIndex = async (
    outputPath: string,
    rootDir = '.',
    options: BuildSearchIndexOptions = {},
): Promise<SearchIndexStats> => {
    const startedAt = Date.now();
    console.log('🔍 Building search index...');

    // Load corpus data
    const data = await loadLocalRuntimeData(rootDir);
    console.log(`   ✓ Loaded ${data.collections.length} collections`);
    const resolvedOptions = resolveIndexOptions(options);

    // Dynamic import of pagefind (it's a dev dependency)
    const pagefind = options.pagefind ?? ((await import('pagefind')) as unknown as PagefindModule);

    // Create the Pagefind index
    const { index } = await pagefind.createIndex({
        forceLanguage: 'ar',
    });

    if (!index) {
        throw new Error('Failed to create Pagefind index');
    }

    const stats: SearchIndexStats = {
        totalRecords: 0,
        totalExcerpts: 0,
        totalCollections: data.collections.length,
        byCollection: {},
        durationMs: 0,
    };

    const { recordCount, byCollection } = await indexCorpusRecords(index, data, resolvedOptions);
    stats.byCollection = byCollection;

    stats.totalRecords = recordCount;
    stats.totalExcerpts = recordCount;

    console.log(`   ✓ Indexed ${recordCount} excerpt records`);

    // Write the index to disk
    await mkdir(outputPath, { recursive: true });
    const { errors: writeErrors } = await index.writeFiles({
        outputPath,
    });

    if (writeErrors && writeErrors.length > 0) {
        throw new Error(`Failed to write search index: ${writeErrors.join(', ')}`);
    }

    await pagefind.close();

    stats.durationMs = Date.now() - startedAt;
    console.log(`   ✓ Search index written to ${outputPath}`);
    console.log(`   ✓ Build completed in ${(stats.durationMs / 1000).toFixed(1)}s`);

    return stats;
};

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
    const args = process.argv.slice(2);
    const normalizePositiveNumber = (value: number | undefined) =>
        typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
    const outputFlag = args.indexOf('--output');
    const outputPath = outputFlag >= 0 && args[outputFlag + 1] ? args[outputFlag + 1] : 'public/pagefind';
    const maxCharsFlag = args.indexOf('--max-chars');
    const maxChars = maxCharsFlag >= 0 && args[maxCharsFlag + 1] ? Number(args[maxCharsFlag + 1]) : DEFAULT_MAX_CHARS;
    const maxRecordsFlag = args.indexOf('--max-records');
    const maxRecords = maxRecordsFlag >= 0 && args[maxRecordsFlag + 1] ? Number(args[maxRecordsFlag + 1]) : undefined;
    const collectionsFlag = args.indexOf('--collections');
    const collections =
        collectionsFlag >= 0 && args[collectionsFlag + 1]
            ? args[collectionsFlag + 1].split(',').map((value) => value.trim())
            : undefined;
    const logEveryFlag = args.indexOf('--log-every');
    const logEvery = logEveryFlag >= 0 && args[logEveryFlag + 1] ? Number(args[logEveryFlag + 1]) : undefined;

    await buildSearchIndex(outputPath, '.', {
        maxChars: normalizePositiveNumber(maxChars) ?? DEFAULT_MAX_CHARS,
        maxRecords: normalizePositiveNumber(maxRecords),
        collections,
        logEvery: normalizePositiveNumber(logEvery),
    });
}
