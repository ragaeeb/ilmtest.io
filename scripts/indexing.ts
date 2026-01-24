import type { Compilation, Excerpt, Heading } from '@/types/excerpts';

/**
 * Pre-computed indexes for O(1) lookups.
 * Generated during setup and stored as JSON for runtime use.
 */
export type LookupIndexes = {
    /** Map section/heading ID → array of excerpt IDs under that section */
    sectionToExcerpts: Record<string, string[]>;

    /** Map excerpt ID → section/heading ID it belongs to */
    excerptToSection: Record<string, string>;

    /** Map page number → heading ID for that page */
    pageToHeading: Record<number, string>;

    /** Map collection ID → array of heading IDs (for TOC) */
    collectionToSections: Record<string, string[]>;

    /** Map collection ID → section ID → ordered chunk IDs for that section */
    sectionToChunks: Record<string, Record<string, string[]>>;

    /** Map collection ID → excerpt ID → chunk ID that contains it */
    excerptToChunk: Record<string, Record<string, string>>;

    /** Map entity ID → collections they're associated with */
    entityToCollections: Record<
        string,
        {
            authorOf: string[];
            mentionedIn?: string[];
        }
    >;
};

/**
 * Find which heading/section a given excerpt belongs to.
 * An excerpt belongs to a heading if its `from` page is >= heading's `from` page
 * and < the next heading's `from` page.
 */
export const findSectionForExcerpt = (excerpt: Excerpt, headings: Heading[]): string | null => {
    if (headings.length === 0) {
        return null;
    }

    // Sort headings by their `from` page
    const sortedHeadings = [...headings].sort((a, b) => a.from - b.from);

    // Find the last heading whose `from` is <= excerpt's `from`
    let matchedHeading: Heading | null = null;

    for (const heading of sortedHeadings) {
        if (heading.from <= excerpt.from) {
            matchedHeading = heading;
        } else {
            break;
        }
    }

    return matchedHeading?.id ?? null;
};

/**
 * Generate all lookup indexes from excerpts data.
 * @param data - The excerpts data
 * @param collectionId - The collection ID (not slug)
 */
export const generateIndexes = (data: Compilation, collectionId: string): Partial<LookupIndexes> => {
    const sectionToExcerpts: Record<string, string[]> = {};
    const excerptToSection: Record<string, string> = {};
    const pageToHeading: Record<number, string> = {};
    const collectionToSections: Record<string, string[]> = {};

    // Map each heading's page to heading ID
    for (const heading of data.headings) {
        pageToHeading[heading.from] = heading.id;
        sectionToExcerpts[heading.id] = []; // Initialize empty array
    }

    // Map collection to its sections
    collectionToSections[collectionId] = data.headings.map((h) => h.id);

    // Map each excerpt to its section
    for (const excerpt of data.excerpts) {
        const sectionId = findSectionForExcerpt(excerpt, data.headings);

        if (sectionId) {
            excerptToSection[excerpt.id] = sectionId;

            if (!sectionToExcerpts[sectionId]) {
                sectionToExcerpts[sectionId] = [];
            }
            sectionToExcerpts[sectionId].push(excerpt.id);
        }
    }

    return {
        sectionToExcerpts,
        excerptToSection,
        pageToHeading,
        collectionToSections,
    };
};

/**
 * Merge multiple partial indexes into a complete index.
 */
export const mergeIndexes = (...partials: Partial<LookupIndexes>[]): LookupIndexes => {
    const merged: LookupIndexes = {
        sectionToExcerpts: {},
        excerptToSection: {},
        pageToHeading: {},
        collectionToSections: {},
        sectionToChunks: {},
        excerptToChunk: {},
        entityToCollections: {},
    };

    for (const partial of partials) {
        Object.assign(merged.sectionToExcerpts, partial.sectionToExcerpts);
        Object.assign(merged.excerptToSection, partial.excerptToSection);
        Object.assign(merged.pageToHeading, partial.pageToHeading);
        Object.assign(merged.collectionToSections, partial.collectionToSections);
        Object.assign(merged.sectionToChunks, partial.sectionToChunks);
        Object.assign(merged.excerptToChunk, partial.excerptToChunk);
        Object.assign(merged.entityToCollections, partial.entityToCollections);
    }

    return merged;
};

/**
 * Add entity-collection mappings to indexes.
 */
export const addEntityMappings = (indexes: LookupIndexes, collectionId: string, authorIds: string[]): void => {
    for (const authorId of authorIds) {
        if (!indexes.entityToCollections[authorId]) {
            indexes.entityToCollections[authorId] = { authorOf: [] };
        }
        indexes.entityToCollections[authorId].authorOf.push(collectionId);
    }
};
