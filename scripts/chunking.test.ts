import { describe, expect, it } from 'bun:test';
import type { Excerpt } from '../src/types/excerpts';
import { CHUNK_CONFIG, chunkExcerpts, shouldSplitChunk } from './chunking';

// Helper to create mock excerpts
const createMockExcerpts = (count: number, startFrom = 1): Excerpt[] => {
    return Array.from({ length: count }, (_, i) => ({
        id: `P${startFrom + i}`,
        from: startFrom + i,
        nass: `Arabic text ${i}`,
        text: `Translation ${i}`,
        translator: 890,
        lastUpdatedAt: Date.now() / 1000,
    }));
};

describe('shouldSplitChunk', () => {
    it('should return true when exceeding max items', () => {
        const excerpts = createMockExcerpts(CHUNK_CONFIG.MAX_ITEMS + 1);
        expect(shouldSplitChunk(excerpts)).toBe(true);
    });

    it('should return false for small chunks', () => {
        const excerpts = createMockExcerpts(10);
        expect(shouldSplitChunk(excerpts)).toBe(false);
    });

    it('should return true when exceeding max size', () => {
        // Create excerpts with large text to exceed size limit
        const largeExcerpts: Excerpt[] = Array.from({ length: 50 }, (_, i) => ({
            id: `P${i}`,
            from: i,
            nass: 'A'.repeat(3000), // 3KB per excerpt
            text: 'B'.repeat(3000),
            translator: 890,
            lastUpdatedAt: 0,
        }));
        expect(shouldSplitChunk(largeExcerpts)).toBe(true);
    });
});

describe('chunkExcerpts', () => {
    it('should return empty array for empty excerpts', () => {
        const chunks = chunkExcerpts([], 'H1');
        expect(chunks).toEqual([]);
    });

    it('should create single chunk for small excerpt list', () => {
        const excerpts = createMockExcerpts(10);
        const chunks = chunkExcerpts(excerpts, 'H1');

        expect(chunks).toHaveLength(1);
        expect(chunks[0].sectionId).toBe('H1');
        expect(chunks[0].chunkIndex).toBe(0);
        expect(chunks[0].excerptIds).toHaveLength(10);
    });

    it('should split large excerpt lists into multiple chunks', () => {
        const excerpts = createMockExcerpts(250);
        const chunks = chunkExcerpts(excerpts, 'H1');

        expect(chunks.length).toBeGreaterThan(1);

        // Verify chunk indices are sequential
        chunks.forEach((chunk, i) => {
            expect(chunk.chunkIndex).toBe(i);
            expect(chunk.sectionId).toBe('H1');
        });

        // Verify all excerpts are accounted for
        const totalExcerpts = chunks.reduce((sum, c) => sum + c.excerptIds.length, 0);
        expect(totalExcerpts).toBe(250);
    });

    it('should not create chunks smaller than MIN_ITEMS', () => {
        const excerpts = createMockExcerpts(CHUNK_CONFIG.MAX_ITEMS + 5);
        const chunks = chunkExcerpts(excerpts, 'H1');

        // All but possibly the last chunk should have at least MIN_ITEMS
        for (let i = 0; i < chunks.length - 1; i++) {
            expect(chunks[i].excerptIds.length).toBeGreaterThanOrEqual(CHUNK_CONFIG.MIN_ITEMS);
        }
    });
});
