import { describe, expect, it } from 'bun:test';
import { CHUNK_CONFIG, chunkExcerpts, getChunkFilename, groupAndChunkExcerpts, shouldSplitChunk } from './chunking';
import type { Excerpt } from './types/excerpts';

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
            nass: 'A'.repeat(2000), // 2KB per excerpt
            text: 'B'.repeat(2000),
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
        const excerpts = createMockExcerpts(150);
        const chunks = chunkExcerpts(excerpts, 'H1');

        expect(chunks.length).toBeGreaterThan(1);

        // Verify chunk indices are sequential
        chunks.forEach((chunk, i) => {
            expect(chunk.chunkIndex).toBe(i);
            expect(chunk.sectionId).toBe('H1');
        });

        // Verify all excerpts are accounted for
        const totalExcerpts = chunks.reduce((sum, c) => sum + c.excerptIds.length, 0);
        expect(totalExcerpts).toBe(150);
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

describe('getChunkFilename', () => {
    it('should generate correct filename', () => {
        const filename = getChunkFilename('2576', 'H123', 0);
        expect(filename).toBe('2576-section-H123-0.json');
    });

    it('should sanitize special characters in section ID', () => {
        const filename = getChunkFilename('2576', 'H/123:test', 2);
        expect(filename).toBe('2576-section-H-123-test-2.json');
    });
});

describe('groupAndChunkExcerpts', () => {
    it('should group excerpts by section and chunk them', () => {
        const excerpts = [
            ...createMockExcerpts(30, 1), // Will be section H1
            ...createMockExcerpts(50, 100), // Will be section H2
        ];

        const excerptToSection: Record<string, string> = {};
        excerpts.slice(0, 30).forEach((e) => (excerptToSection[e.id] = 'H1'));
        excerpts.slice(30).forEach((e) => (excerptToSection[e.id] = 'H2'));

        const result = groupAndChunkExcerpts(excerpts, excerptToSection, 'test-collection');

        expect(result.has('H1')).toBe(true);
        expect(result.has('H2')).toBe(true);

        const h1Chunks = result.get('H1')!;
        const h2Chunks = result.get('H2')!;

        // H1 should have 30 excerpts in chunks
        const h1Total = h1Chunks.reduce((sum, c) => sum + c.excerptIds.length, 0);
        expect(h1Total).toBe(30);

        // H2 should have 50 excerpts in chunks
        const h2Total = h2Chunks.reduce((sum, c) => sum + c.excerptIds.length, 0);
        expect(h2Total).toBe(50);
    });

    it('should preserve excerpt order within chunks', () => {
        const excerpts = createMockExcerpts(10, 50);
        const excerptToSection: Record<string, string> = {};
        excerpts.forEach((e) => (excerptToSection[e.id] = 'H1'));

        const result = groupAndChunkExcerpts(excerpts, excerptToSection, 'test-collection');
        const chunks = result.get('H1')!;

        // Verify order is preserved (sorted by 'from')
        const allExcerpts = chunks.flatMap((c) => c.excerpts);
        for (let i = 1; i < allExcerpts.length; i++) {
            expect(allExcerpts[i].from).toBeGreaterThanOrEqual(allExcerpts[i - 1].from);
        }
    });
});
