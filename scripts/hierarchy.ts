import type { BookData } from 'shamela';
import type { ScrapeResult } from '@/types/asl';
import type { Compilation, Excerpt, Heading } from '@/types/excerpts';

export type Hierarchy = {
    heading: Heading;
    excerpts: Excerpt[];
};

/**
 * Build hierarchy for Shamela books with nested titles
 * Returns flat list of headings with their direct excerpts
 * Parent/child relationships preserved in heading.parent field
 */
const buildShamelaHierarchy = (compilation: Compilation & { sourceDocument: BookData }): Hierarchy[] => {
    // Group excerpts by heading ID using the index
    const headingToExcerpts = new Map<string, Excerpt[]>();

    // Initialize empty arrays for all headings
    for (const heading of compilation.headings) {
        headingToExcerpts.set(heading.id, []);
    }

    // Assign excerpts to headings based on page ranges
    // An excerpt belongs to a heading if it's within the heading's page range
    for (const excerpt of compilation.excerpts) {
        for (const heading of compilation.headings) {
            // Skip headings without computed ranges
            if (!heading.from) {
                continue;
            }

            // Find the heading that contains this excerpt's page
            // For now, use simple page-based assignment
            // (This will be improved when we have proper range computation)
            let belongsToHeading = false;

            // Check if excerpt is on or after this heading's page
            if (excerpt.from >= heading.from) {
                // Find next heading at same or higher level to determine range
                const nextHeading = compilation.headings.find((h) => {
                    if (h.from <= heading.from) {
                        return false;
                    }
                    // For parent headings, only stop at another parent
                    // For child headings, stop at any sibling or parent
                    return true; // Simplified for now
                });

                const endPage = nextHeading ? nextHeading.from - 1 : Infinity;
                belongsToHeading = excerpt.from <= endPage;
            }

            if (belongsToHeading) {
                headingToExcerpts.get(heading.id)!.push(excerpt);
                break; // Assign to first matching heading
            }
        }
    }

    return compilation.headings.map((heading) => ({
        heading,
        excerpts: headingToExcerpts.get(heading.id) || [],
    }));
};

/**
 * Build hierarchy for web scraped content
 * One heading per page, excerpts grouped by page
 */
const buildWebHierarchy = (compilation: Compilation & { sourceDocument: ScrapeResult }): Hierarchy[] => {
    const pageToExcerpts = Object.groupBy(compilation.excerpts, (e) => e.from);

    const result: Hierarchy[] = [];

    for (const heading of compilation.headings) {
        const excerpts = pageToExcerpts[heading.from] || [];
        result.push({ heading, excerpts });
    }

    return result;
};

/**
 * Build hierarchy based on source document type
 */
export const buildHierarchy = (compilation: Compilation): Hierarchy[] => {
    if ((compilation.sourceDocument as BookData).titles) {
        return buildShamelaHierarchy(compilation as any);
    }

    return buildWebHierarchy(compilation as any);
};

/**
 * Get top-level headings (no parent)
 */
export const getTopLevelHeadings = (headings: Heading[]): Heading[] => {
    return headings.filter((h) => !('parent' in h) || !h.parent);
};
