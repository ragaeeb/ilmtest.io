import type { BookData } from 'shamela';
import type { ScrapeResult } from '@/types/asl';
import type { Compilation, Excerpt, Heading } from '@/types/excerpts';
import { mapHeadingIdToShamelaTitleId } from './mapping';

type Hierarchy = {
    excerpts: Excerpt[];
    heading: Heading;
};

const buildShamelaHierarchy = (compilation: Compilation & { sourceDocument: BookData }) => {
    compilation.headings.map(mapHeadingIdToShamelaTitleId);
};

const buildWebHierarchy = (compilation: Compilation & { sourceDocument: ScrapeResult }) => {
    const pageToExcerpts = Object.groupBy(compilation.excerpts, (e) => e.from);

    const result: Hierarchy[] = [];

    for (const heading of compilation.headings) {
        const excerpts = pageToExcerpts[heading.from] || [];
        result.push({ heading, excerpts });
    }

    return result;
};

export const buildHierarchy = (compilation: Compilation) => {
    if ((compilation.sourceDocument as BookData).titles) {
        return buildShamelaHierarchy(compilation as any);
    }

    return buildWebHierarchy(compilation as any);
};
