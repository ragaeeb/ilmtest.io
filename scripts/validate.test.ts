import { describe, expect, it } from 'bun:test';
import type { Compilation, Excerpt, Heading } from '../src/types/excerpts';
import type { LookupIndexes } from './indexing';
import {
    type ValidationResult,
    validateDuplicateIds,
    validateExcerpts,
    validateIndexIntegrity,
    validateMissingTranslations,
    validateOrphanedExcerpts,
} from './validate';

const createExcerpt = (id: string, overrides: Partial<Excerpt> = {}): Excerpt => ({
    id,
    from: 1,
    nass: 'نص عربي',
    text: 'English text',
    translator: 890,
    lastUpdatedAt: 0,
    ...overrides,
});

const createHeading = (id: string, from: number): Heading => ({
    id,
    from,
    nass: 'عنوان',
    text: 'Title',
    translator: 890,
    lastUpdatedAt: 0,
});

describe('validateOrphanedExcerpts', () => {
    it('should detect excerpts not mapped to any section', () => {
        const excerpts = [createExcerpt('E1'), createExcerpt('E2'), createExcerpt('E3')];

        const excerptToSection: Record<string, string> = {
            E1: 'H1',
            // E2 is missing - orphaned
            E3: 'H2',
        };

        const results = validateOrphanedExcerpts(excerpts, excerptToSection);

        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('ORPHANED_EXCERPT');
        expect(results[0].excerptId).toBe('E2');
        expect(results[0].type).toBe('error');
    });

    it('should return empty array when all excerpts are mapped', () => {
        const excerpts = [createExcerpt('E1'), createExcerpt('E2')];

        const excerptToSection: Record<string, string> = {
            E1: 'H1',
            E2: 'H2',
        };

        const results = validateOrphanedExcerpts(excerpts, excerptToSection);
        expect(results).toHaveLength(0);
    });
});

describe('validateMissingTranslations', () => {
    it('should detect excerpts with empty text', () => {
        const excerpts = [createExcerpt('E1', { text: '' }), createExcerpt('E2')];

        const results = validateMissingTranslations(excerpts);

        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('MISSING_TRANSLATION');
        expect(results[0].excerptId).toBe('E1');
    });

    it('should detect excerpts with empty nass', () => {
        const excerpts = [createExcerpt('E1', { nass: '' }), createExcerpt('E2')];

        const results = validateMissingTranslations(excerpts);

        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('MISSING_ARABIC');
        expect(results[0].excerptId).toBe('E1');
    });

    it('should return empty array for complete excerpts', () => {
        const excerpts = [createExcerpt('E1'), createExcerpt('E2')];

        const results = validateMissingTranslations(excerpts);
        expect(results).toHaveLength(0);
    });
});

describe('validateDuplicateIds', () => {
    it('should detect duplicate excerpt IDs', () => {
        const excerpts = [createExcerpt('E1'), createExcerpt('E1'), createExcerpt('E2')];

        const headings: Heading[] = [];

        const results = validateDuplicateIds(excerpts, headings);

        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('DUPLICATE_ID');
        expect(results[0].excerptId).toBe('E1');
    });

    it('should detect duplicate heading IDs', () => {
        const excerpts: Excerpt[] = [];
        const headings = [createHeading('H1', 1), createHeading('H1', 10)];

        const results = validateDuplicateIds(excerpts, headings);

        expect(results).toHaveLength(1);
        expect(results[0].code).toBe('DUPLICATE_ID');
        expect(results[0].sectionId).toBe('H1');
    });

    it('should return empty array for unique IDs', () => {
        const excerpts = [createExcerpt('E1'), createExcerpt('E2')];
        const headings = [createHeading('H1', 1), createHeading('H2', 10)];

        const results = validateDuplicateIds(excerpts, headings);
        expect(results).toHaveLength(0);
    });
});

describe('validateIndexIntegrity', () => {
    it('should detect missing excerpt in excerptToSection index', () => {
        const excerpts = [createExcerpt('E1'), createExcerpt('E2')];

        const indexes: LookupIndexes = {
            sectionToExcerpts: { H1: ['E1', 'E3'] }, // E3 doesn't exist
            excerptToSection: { E1: 'H1', E3: 'H1' },
            pageToHeading: {},
            collectionToSections: {},
            entityToCollections: {},
        };

        const results = validateIndexIntegrity(indexes, excerpts);

        expect(results.some((r) => r.code === 'INDEX_MISSING_EXCERPT' && r.excerptId === 'E3')).toBe(true);
    });

    it('should return empty array for valid indexes', () => {
        const excerpts = [createExcerpt('E1'), createExcerpt('E2')];

        const indexes: LookupIndexes = {
            sectionToExcerpts: { H1: ['E1', 'E2'] },
            excerptToSection: { E1: 'H1', E2: 'H1' },
            pageToHeading: {},
            collectionToSections: {},
            entityToCollections: {},
        };

        const results = validateIndexIntegrity(indexes, excerpts);
        expect(results).toHaveLength(0);
    });
});

describe('validateExcerpts', () => {
    it('should run all validations and aggregate results', () => {
        const data: Compilation = {
            excerpts: [
                createExcerpt('E1'),
                createExcerpt('E1'), // duplicate
                createExcerpt('E2', { text: '' }), // missing translation
            ],
            headings: [createHeading('H1', 1)],
            collection: {} as any,
            footnotes: [],
            contractVersion: '1.0',
            createdAt: 0,
            lastUpdatedAt: 0,
        };

        const indexes: LookupIndexes = {
            sectionToExcerpts: { H1: ['E1'] },
            excerptToSection: { E1: 'H1' }, // E2 is orphaned
            pageToHeading: {},
            collectionToSections: {},
            entityToCollections: {},
        };

        const results = validateExcerpts(data, indexes);

        // Should have: 1 duplicate, 1 missing translation, 1 orphaned
        expect(results.length).toBeGreaterThanOrEqual(3);
        expect(results.some((r) => r.code === 'DUPLICATE_ID')).toBe(true);
        expect(results.some((r) => r.code === 'MISSING_TRANSLATION')).toBe(true);
        expect(results.some((r) => r.code === 'ORPHANED_EXCERPT')).toBe(true);
    });
});
