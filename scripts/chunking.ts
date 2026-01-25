import type { Excerpt } from '@/types/excerpts';

/**
 * Chunking configuration
 */
export const CHUNK_CONFIG = {
    /** Maximum number of excerpts per chunk */
    MAX_ITEMS: 200,
    /** Target maximum uncompressed size in bytes (~200KB) */
    MAX_SIZE_BYTES: 200 * 1024,
    /** Minimum items before creating a new chunk */
    MIN_ITEMS: 50,
};

/**
 * A chunk of excerpts for a specific section.
 */
export type ExcerptChunk = {
    /** Section/heading ID this chunk belongs to */
    sectionId: string;
    /** Chunk index (0-based) for sections with multiple chunks */
    chunkIndex: number;
    /** Excerpt IDs in this chunk */
    excerptIds: string[];
    /** The actual excerpts */
    excerpts: Excerpt[];
};

/**
 * Check if a chunk should be split based on size and item count.
 */
export const shouldSplitChunk = (excerpts: Excerpt[]): boolean => {
    if (excerpts.length >= CHUNK_CONFIG.MAX_ITEMS) {
        return true;
    }

    const sizeBytes = JSON.stringify(excerpts).length;
    return sizeBytes > CHUNK_CONFIG.MAX_SIZE_BYTES;
};

/**
 * Split an array of excerpts into chunks respecting size and count limits.
 */
export const chunkExcerpts = (excerpts: Excerpt[], sectionId: string): ExcerptChunk[] => {
    if (excerpts.length === 0) {
        return [];
    }

    const chunks: ExcerptChunk[] = [];
    let currentChunk: Excerpt[] = [];
    let chunkIndex = 0;

    for (const excerpt of excerpts) {
        currentChunk.push(excerpt);

        // Check if we need to split
        if (shouldSplitChunk(currentChunk) && currentChunk.length >= CHUNK_CONFIG.MIN_ITEMS) {
            chunks.push({
                sectionId,
                chunkIndex,
                excerptIds: currentChunk.map((e) => e.id),
                excerpts: currentChunk,
            });
            currentChunk = [];
            chunkIndex++;
        }
    }

    // Add remaining excerpts as final chunk
    if (currentChunk.length > 0) {
        chunks.push({
            sectionId,
            chunkIndex,
            excerptIds: currentChunk.map((e) => e.id),
            excerpts: currentChunk,
        });
    }

    return chunks;
};
