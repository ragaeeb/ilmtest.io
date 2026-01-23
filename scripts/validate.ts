import type { Excerpt, Excerpts, Heading } from '@/types/excerpts';
import type { LookupIndexes } from './indexing';

/**
 * Result of a validation check.
 */
export type ValidationResult = {
    /** Severity: 'error' for data integrity issues, 'warning' for potential issues */
    type: 'error' | 'warning';
    /** Unique code identifying the validation failure */
    code: string;
    /** Human-readable description of the issue */
    message: string;
    /** Affected excerpt ID, if applicable */
    excerptId?: string;
    /** Affected section/heading ID, if applicable */
    sectionId?: string;
};

/**
 * Detect excerpts that are not mapped to any section.
 */
export const validateOrphanedExcerpts = (
    excerpts: Excerpt[],
    excerptToSection: Record<string, string>,
): ValidationResult[] => {
    const results: ValidationResult[] = [];

    for (const excerpt of excerpts) {
        if (!excerptToSection[excerpt.id]) {
            results.push({
                type: 'error',
                code: 'ORPHANED_EXCERPT',
                message: `Excerpt ${excerpt.id} is not mapped to any section`,
                excerptId: excerpt.id,
            });
        }
    }

    return results;
};

/**
 * Detect excerpts with missing Arabic text or English translation.
 */
export const validateMissingTranslations = (excerpts: Excerpt[]): ValidationResult[] => {
    const results: ValidationResult[] = [];

    for (const excerpt of excerpts) {
        if (!excerpt.text || excerpt.text.trim() === '') {
            results.push({
                type: 'error',
                code: 'MISSING_TRANSLATION',
                message: `Excerpt ${excerpt.id} has no English translation`,
                excerptId: excerpt.id,
            });
        }

        if (!excerpt.nass || excerpt.nass.trim() === '') {
            results.push({
                type: 'error',
                code: 'MISSING_ARABIC',
                message: `Excerpt ${excerpt.id} has no Arabic text`,
                excerptId: excerpt.id,
            });
        }
    }

    return results;
};

/**
 * Detect duplicate IDs in excerpts or headings.
 */
export const validateDuplicateIds = (excerpts: Excerpt[], headings: Heading[]): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const excerptIds = new Set<string>();
    const headingIds = new Set<string>();

    for (const excerpt of excerpts) {
        if (excerptIds.has(excerpt.id)) {
            results.push({
                type: 'error',
                code: 'DUPLICATE_ID',
                message: `Duplicate excerpt ID: ${excerpt.id}`,
                excerptId: excerpt.id,
            });
        }
        excerptIds.add(excerpt.id);
    }

    for (const heading of headings) {
        if (headingIds.has(heading.id)) {
            results.push({
                type: 'error',
                code: 'DUPLICATE_ID',
                message: `Duplicate heading ID: ${heading.id}`,
                sectionId: heading.id,
            });
        }
        headingIds.add(heading.id);
    }

    return results;
};

/**
 * Verify that all excerpt IDs in indexes exist in the data.
 */
export const validateIndexIntegrity = (indexes: LookupIndexes, excerpts: Excerpt[]): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const excerptIds = new Set(excerpts.map((e) => e.id));

    // Check sectionToExcerpts
    for (const [sectionId, excerptIdList] of Object.entries(indexes.sectionToExcerpts)) {
        for (const excerptId of excerptIdList) {
            if (!excerptIds.has(excerptId)) {
                results.push({
                    type: 'error',
                    code: 'INDEX_MISSING_EXCERPT',
                    message: `Index references non-existent excerpt ${excerptId} in section ${sectionId}`,
                    excerptId,
                    sectionId,
                });
            }
        }
    }

    return results;
};

/**
 * Run all validations and aggregate results.
 */
export const validateExcerpts = (data: Excerpts, indexes: LookupIndexes): ValidationResult[] => {
    const results: ValidationResult[] = [];

    results.push(...validateDuplicateIds(data.excerpts, data.headings));
    results.push(...validateMissingTranslations(data.excerpts));
    results.push(...validateOrphanedExcerpts(data.excerpts, indexes.excerptToSection));
    results.push(...validateIndexIntegrity(indexes, data.excerpts));

    return results;
};

/**
 * Print validation results to console.
 */
export const printValidationResults = (results: ValidationResult[]): void => {
    const errors = results.filter((r) => r.type === 'error');
    const warnings = results.filter((r) => r.type === 'warning');

    if (errors.length > 0) {
        console.error(`\n❌ ${errors.length} error(s) found:`);
        for (const error of errors) {
            console.error(`  [${error.code}] ${error.message}`);
        }
    }

    if (warnings.length > 0) {
        console.warn(`\n⚠️ ${warnings.length} warning(s) found:`);
        for (const warning of warnings) {
            console.warn(`  [${warning.code}] ${warning.message}`);
        }
    }

    if (errors.length === 0 && warnings.length === 0) {
        console.log('\n✅ All validations passed!');
    }
};
