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
 *   bun scripts/buildSearchIndex.ts [--output dist/dist/pagefind]
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

// ---------------------------------------------------------------------------
// Record building (pure, testable)
// ---------------------------------------------------------------------------

/**
 * Truncate long text for search content to keep index sizes reasonable.
 * Pagefind indexes the text for search internally; we don't need the full
 * multi-page nass if it's enormous.
 */
const truncateForIndex = (text: string, maxChars = 4000): string => {
    if (text.length <= maxChars) {
        return text;
    }

    return `${text.slice(0, maxChars)}…`;
};

/**
 * Build a combined search content string from an excerpt.
 * Arabic text is placed first, then a separator, then the translation.
 */
const buildSearchContent = (excerpt: Excerpt): string => {
    const parts: string[] = [];

    if (excerpt.nass?.trim()) {
        parts.push(truncateForIndex(excerpt.nass.trim()));
    }

    if (excerpt.text?.trim()) {
        parts.push(truncateForIndex(excerpt.text.trim()));
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
    const { excerpt, collection, sectionId, sectionTitle } = ctx;

    const url = `/browse/${collection.slug}/${sectionId}/e/${excerpt.id}`;
    const content = buildSearchContent(excerpt);
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
export const iterateCorpusExcerpts = async function* (data: LocalRuntimeData): AsyncGenerator<ExcerptWithContext> {
    const chunksDir = data.paths.chunksDir;
    const indexes = data.indexes;

    for (const collection of data.collections) {
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

export const buildSearchIndex = async (outputPath: string, rootDir = '.'): Promise<SearchIndexStats> => {
    const startedAt = Date.now();
    console.log('🔍 Building search index...');

    // Load corpus data
    const data = await loadLocalRuntimeData(rootDir);
    console.log(`   ✓ Loaded ${data.collections.length} collections`);

    // Dynamic import of pagefind (it's a dev dependency)
    const pagefind = await import('pagefind');

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

    let recordCount = 0;

    for await (const ctx of iterateCorpusExcerpts(data)) {
        const record = buildSearchRecord(ctx);

        const { errors } = await index.addCustomRecord(record);

        if (errors && errors.length > 0) {
            console.warn(`   ⚠ Error indexing ${record.url}:`, errors);
            continue;
        }

        recordCount++;
        stats.byCollection[ctx.collection.slug] = (stats.byCollection[ctx.collection.slug] ?? 0) + 1;

        if (recordCount % 1000 === 0) {
            console.log(`   … indexed ${recordCount} records`);
        }
    }

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
    const outputFlag = args.indexOf('--output');
    const outputPath = outputFlag >= 0 && args[outputFlag + 1] ? args[outputFlag + 1] : 'dist/dist/pagefind';

    await buildSearchIndex(outputPath);
}
