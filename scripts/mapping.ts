import type { Title } from 'shamela';
import type { Heading } from '@/types/excerpts';

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

type HeadingNode = Heading & {
    children?: HeadingNode[];
};

export const mapTitleTreeToHeadingTree = (titleNodes: TitleNode[], headings: Heading[]) => {
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

    return titleNodes.filter((t) => titleIdToHeading.has(t.id)).map(convertNode);
};
