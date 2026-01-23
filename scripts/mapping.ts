import type { BookData, Page, Title } from 'shamela';
import type { Excerpt, Excerpts, Heading } from './types/excerpts';

/**
 * When the user gets a shareable link to an excerpt and they open it, there hould be a hard link to exactly where this excerpt was taken from its original library.
 */
export const mapExcerptToCitation = (e: Excerpt, citationTemplate: string) => {
    return citationTemplate.replace(':page', e.from.toString());
};

const copyCitationDataToMeta = (pages: Page[], excerpts: Excerpt[]) => {
    const idToPage = new Map<number, Page>();

    pages.forEach((p) => {
        idToPage.set(p.id, p);
    });

    excerpts.forEach((e) => {
        const page = idToPage.get(e.from)!;

        if (page.part?.match(/^\d+$/)) {
            e.meta = { ...e.meta, vol: Number(page.part) };

            if (page.page) {
                e.meta.vp = page.page;
            }
        }
    });
};

export type TitleNode = Title & {
    children?: TitleNode[];
};

export const mapTitlesToTableOfContents = (titles: Title[]) => {
    const lookup = new Map<number, TitleNode>();
    const roots: TitleNode[] = [];

    // First pass: create lookup
    for (const title of titles) {
        lookup.set(title.id, title as TitleNode);
    }

    // Second pass: build tree
    for (const title of titles) {
        const node = lookup.get(title.id)!;

        if (!title.parent) {
            roots.push(node);
        } else {
            const parent = lookup.get(title.parent)!;
            parent.children ??= [];
            parent.children.push(node);
        }
    }

    return roots;
};

export const mapHeadingIdToShamelaTitleId = (heading: Heading) => parseInt(heading.id.slice(1), 10);

export const mapHeadingsToShamelaTitles = (headings: Heading[], titles: Title[]) => {
    const headingToTitle = new Map<Heading, Title>();
    const idToTitle = new Map<number, Title>();

    for (const t of titles) {
        idToTitle.set(t.id, t);
    }

    for (const heading of headings) {
        const titleId = mapHeadingIdToShamelaTitleId(heading);
        const title = idToTitle.get(titleId)!;
        headingToTitle.set(heading, title);
    }

    return headingToTitle;
};

type HeadingNode = Heading & {
    children?: HeadingNode[];
};

export const mapTitleTreeToHeadingTree = (titleNodes: TitleNode[], headings: Heading[]): HeadingNode[] => {
    // Create a map from title ID to heading
    const titleIdToHeading = new Map<number, Heading>();

    for (const heading of headings) {
        const titleId = mapHeadingIdToShamelaTitleId(heading);
        titleIdToHeading.set(titleId, heading);
    }

    // Recursively convert TitleNode tree to HeadingNode tree
    const convertNode = (titleNode: TitleNode): HeadingNode => {
        const heading = titleIdToHeading.get(titleNode.id)!;

        const headingNode: HeadingNode = { ...heading };

        if (titleNode.children?.length) {
            headingNode.children = titleNode.children.map(convertNode);
        }

        return headingNode;
    };

    return titleNodes.map(convertNode);
};

export const getTitleTreeForPage = (nodes: TitleNode[], page: number) => {
    // Find the last root node where page <= given page
    let activeRoot = nodes[0];

    for (const node of nodes) {
        if (node.page <= page) {
            activeRoot = node;
        }
    }

    // Recursively filter the tree to only show children with page <= given page
    const filterTree = (node: TitleNode): TitleNode => {
        const filteredChildren = (node.children || []).filter((child) => child.page <= page).map(filterTree);

        return {
            ...node,
            children: filteredChildren,
        };
    };

    return filterTree(activeRoot);
};

export const getExcerptsUnderTitle = (
    titles: TitleNode[],
    excerpts: Excerpt[],
    selectedTitle: TitleNode,
): Excerpt[] => {
    // Find the next title page that "closes" this section
    const nextTitlePage = findNextTitleAtSameLevelOrHigher(titles, selectedTitle);

    // If no children, return all excerpts in the range
    if (!selectedTitle.children?.length) {
        return excerpts.filter((e) => e.from >= selectedTitle.page && e.from < nextTitlePage);
    }

    const firstChildPage = selectedTitle.children[0].page;

    // Direct level: excerpts between title and first child
    const directExcerpts = excerpts.filter((e) => e.from >= selectedTitle.page && e.from < firstChildPage);

    // Deep level: excerpts at or after first child (nested content)
    const deepExcerpts = excerpts.filter((e) => e.from >= firstChildPage && e.from < nextTitlePage);

    // Return whichever level has more excerpts (prefer direct on tie)
    return deepExcerpts.length > directExcerpts.length ? deepExcerpts : directExcerpts;
};

// Helper: Find the next title at the same level or higher
const findNextTitleAtSameLevelOrHigher = (titles: TitleNode[], selectedTitle: TitleNode): number => {
    // Flatten all titles with their depth
    const flatTitles: Array<{ node: TitleNode; depth: number }> = [];

    const flatten = (nodes: TitleNode[], depth: number) => {
        for (const node of nodes) {
            flatTitles.push({ node, depth });
            if (node.children?.length) {
                flatten(node.children, depth + 1);
            }
        }
    };

    flatten(titles, 0);

    // Find selected title's index and depth
    const selectedIndex = flatTitles.findIndex((t) => t.node.id === selectedTitle.id);
    const selectedDepth = flatTitles[selectedIndex].depth;

    // Find next title at same or higher level (lower depth number)
    for (let i = selectedIndex + 1; i < flatTitles.length; i++) {
        if (flatTitles[i].depth <= selectedDepth) {
            return flatTitles[i].node.page;
        }
    }

    return Infinity;
};

/**
 * Utility function to ground citations for each excerpt.
 * @param excerpt
 * @param bookData
 */
export const groundShamelaExcerpts = (data: Excerpts, bookData: BookData) => {
    copyCitationDataToMeta(bookData.pages, data.excerpts);
};

const ARABIC_TO_WESTERN: Record<string, string> = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
} as const;

export const arabicToWestern = (arabicNum: string) => {
    const western = arabicNum.replace(/[٠-٩]/g, (d) => ARABIC_TO_WESTERN[d]);
    return parseInt(western, 10);
};
