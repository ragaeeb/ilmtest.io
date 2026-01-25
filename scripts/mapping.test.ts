import { describe, expect, it } from 'bun:test';
import type { Heading } from '../src/types/excerpts';
import { mapTitlesToTableOfContents, mapTitleTreeToHeadingTree, type TitleNode } from './mapping';

describe('mapTitlesToTableOfContents', () => {
    it('should return empty array for empty input', () => {
        const result = mapTitlesToTableOfContents([]);
        expect(result).toEqual([]);
    });

    it('should return single root node without children', () => {
        const titles = [{ id: 1, content: 'Chapter 1' }] as any;
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
        expect(result[0].content).toBe('Chapter 1');
        expect(result[0].children).toBeUndefined();
    });

    it('should return multiple root nodes', () => {
        const titles = [
            { id: 1, content: 'Chapter 1' },
            { id: 2, content: 'Chapter 2' },
            { id: 3, content: 'Chapter 3' },
        ] as any;
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toHaveLength(3);
        expect(result[0].id).toBe(1);
        expect(result[1].id).toBe(2);
        expect(result[2].id).toBe(3);
    });

    it('should handle Sahih al-Bukhari', () => {
        const titles = [
            {
                content: 'بيان الشيخ حسونة ﵀',
                id: 1,
                page: 1,
            },
            {
                content: 'مقدمة مصححي الطبعة',
                id: 2,
                page: 5,
            },
            {
                content: 'بدء الوحي',
                id: 3,
                page: 9,
            },
            {
                content: 'باب كيف كان بدء الوحي إلى رسول الله',
                id: 4,
                page: 9,
                parent: 3,
            },
            {
                content: 'كتاب الإيمان',
                id: 5,
                page: 17,
            },
            {
                content: 'باب قول النبي ﷺ بني الإسلام على خمس',
                id: 6,
                page: 17,
                parent: 5,
            },
            {
                content: 'باب دعاؤكم إيمانكم',
                id: 7,
                page: 18,
                parent: 5,
            },
        ];
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toEqual([
            { content: 'بيان الشيخ حسونة ﵀', id: 1, page: 1 },
            { content: 'مقدمة مصححي الطبعة', id: 2, page: 5 },
            {
                content: 'بدء الوحي',
                id: 3,
                page: 9,
                children: [{ content: 'باب كيف كان بدء الوحي إلى رسول الله', id: 4, page: 9, parent: 3 }],
            },
            {
                content: 'كتاب الإيمان',
                id: 5,
                page: 17,
                children: [
                    { content: 'باب قول النبي ﷺ بني الإسلام على خمس', id: 6, page: 17, parent: 5 },
                    { content: 'باب دعاؤكم إيمانكم', id: 7, page: 18, parent: 5 },
                ],
            },
        ]);
    });

    it('should nest single child under parent', () => {
        const titles = [
            { id: 1, content: 'Chapter 1' },
            { id: 2, content: 'Section 1.1', parent: 1 },
        ] as any;
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
        expect(result[0].children).toHaveLength(1);
        expect(result[0].children![0].id).toBe(2);
        expect(result[0].children![0].content).toBe('Section 1.1');
    });

    it('should nest multiple children under same parent', () => {
        const titles = [
            { id: 1, content: 'Chapter 1' },
            { id: 2, content: 'Section 1.1', parent: 1 },
            { id: 3, content: 'Section 1.2', parent: 1 },
            { id: 4, content: 'Section 1.3', parent: 1 },
        ] as any;
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toHaveLength(1);
        expect(result[0].children).toHaveLength(3);
        expect(result[0].children![0].id).toBe(2);
        expect(result[0].children![1].id).toBe(3);
        expect(result[0].children![2].id).toBe(4);
    });

    it('should handle deeply nested structure (3+ levels)', () => {
        const titles = [
            { id: 1, content: 'Chapter 1' },
            { id: 2, content: 'Section 1.1', parent: 1 },
            { id: 3, content: 'Subsection 1.1.1', parent: 2 },
            { id: 4, content: 'Subsubsection 1.1.1.1', parent: 3 },
        ] as any;
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
        expect(result[0].children![0].id).toBe(2);
        expect(result[0].children![0].children![0].id).toBe(3);
        expect(result[0].children![0].children![0].children![0].id).toBe(4);
    });

    it('should handle multiple root nodes with nested children', () => {
        const titles = [
            { id: 1, content: 'Chapter 1' },
            { id: 2, content: 'Section 1.1', parent: 1 },
            { id: 3, content: 'Section 1.2', parent: 1 },
            { id: 4, content: 'Chapter 2' },
            { id: 5, content: 'Section 2.1', parent: 4 },
        ] as any;
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(1);
        expect(result[0].children).toHaveLength(2);
        expect(result[1].id).toBe(4);
        expect(result[1].children).toHaveLength(1);
        expect(result[1].children![0].id).toBe(5);
    });

    it('should work when children are defined before parents', () => {
        const titles = [
            { id: 2, content: 'Section 1.1', parent: 1 },
            { id: 3, content: 'Section 1.2', parent: 1 },
            { id: 1, content: 'Chapter 1' },
        ] as any;
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
        expect(result[0].children).toHaveLength(2);
        expect(result[0].children![0].id).toBe(2);
        expect(result[0].children![1].id).toBe(3);
    });

    it('should preserve original object references (mutation)', () => {
        const titles = [
            { id: 1, content: 'Chapter 1' },
            { id: 2, content: 'Section 1.1', parent: 1 },
        ] as any;
        const result = mapTitlesToTableOfContents(titles);

        // Should mutate the original objects
        expect(result[0]).toBe(titles[0]);
        expect(result[0].children![0]).toBe(titles[1]);
    });

    it('should handle complex mixed hierarchy', () => {
        const titles = [
            { id: 1, content: 'Chapter 1' },
            { id: 2, content: 'Section 1.1', parent: 1 },
            { id: 3, content: 'Subsection 1.1.1', parent: 2 },
            { id: 4, content: 'Subsection 1.1.2', parent: 2 },
            { id: 5, content: 'Section 1.2', parent: 1 },
            { id: 6, content: 'Chapter 2' },
            { id: 7, content: 'Section 2.1', parent: 6 },
            { id: 8, content: 'Subsection 2.1.1', parent: 7 },
        ] as any;
        const result = mapTitlesToTableOfContents(titles);

        expect(result).toHaveLength(2);

        // Chapter 1 structure
        expect(result[0].id).toBe(1);
        expect(result[0].children).toHaveLength(2);
        expect(result[0].children![0].id).toBe(2);
        expect(result[0].children![0].children).toHaveLength(2);
        expect(result[0].children![0].children![0].id).toBe(3);
        expect(result[0].children![0].children![1].id).toBe(4);
        expect(result[0].children![1].id).toBe(5);

        // Chapter 2 structure
        expect(result[1].id).toBe(6);
        expect(result[1].children).toHaveLength(1);
        expect(result[1].children![0].id).toBe(7);
        expect(result[1].children![0].children).toHaveLength(1);
        expect(result[1].children![0].children![0].id).toBe(8);
    });
});

describe('mapTitleTreeToHeadingTree', () => {
    it('should return empty array for empty inputs', () => {
        const result = mapTitleTreeToHeadingTree([], []);
        expect(result).toEqual([]);
    });

    it('should map single root node without children', () => {
        const titleNodes: TitleNode[] = [{ id: 1, page: 1, content: 'Chapter 1' }];

        const headings: Heading[] = [
            {
                id: 'P1',
                nass: 'الفصل الأول',
                text: 'Chapter 1',
                translator: 890,
                lastUpdatedAt: 1234567890,
                from: 1,
            },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result).toHaveLength(1);
        expect(result[0].nass).toBe('الفصل الأول');
        expect(result[0].text).toBe('Chapter 1');
        expect(result[0].translator).toBe(890);
        expect(result[0].lastUpdatedAt).toBe(1234567890);
        expect(result[0].from).toBe(1);
        expect(result[0].children).toBeUndefined();
    });

    it('should handle Sahih al-Bukhari', () => {
        const titleNodes = [
            { content: 'بيان الشيخ حسونة ﵀', id: 1, page: 1 },
            { content: 'مقدمة مصححي الطبعة', id: 2, page: 5 },
            {
                content: 'بدء الوحي',
                id: 3,
                page: 9,
                children: [{ content: 'باب كيف كان بدء الوحي إلى رسول الله', id: 4, page: 9, parent: 3 }],
            },
            {
                content: 'كتاب الإيمان',
                id: 5,
                page: 17,
                children: [
                    { content: 'باب قول النبي ﷺ بني الإسلام على خمس', id: 6, page: 17, parent: 5 },
                    { content: 'باب دعاؤكم إيمانكم', id: 7, page: 18, parent: 5 },
                ],
            },
        ];

        const headings = [
            {
                from: 9,
                id: 'T3',
                lastUpdatedAt: 1764025085,
                nass: 'بدء الوحي',
                text: 'The Beginning of Revelation',
                translator: 891,
            },
            {
                from: 9,
                id: 'T4',
                lastUpdatedAt: 1764025085,
                nass: 'باب كيف كان بدء الوحي إلى رسول الله',
                text: 'Chapter: How the revelation began to the Messenger of Allah',
                translator: 891,
            },
            {
                from: 17,
                id: 'T5',
                lastUpdatedAt: 1764025085,
                nass: 'كتاب الإيمان',
                text: 'Book of Faith',
                translator: 891,
            },
            {
                from: 17,
                id: 'T6',
                lastUpdatedAt: 1764025085,
                nass: 'باب قول النبي ﷺ بني الإسلام على خمس',
                text: 'Chapter: The Prophet\'s ﷺ statement "Islam is built upon five"',
                translator: 891,
            },
            {
                from: 18,
                id: 'T7',
                lastUpdatedAt: 1764025085,
                nass: 'باب دعاؤكم إيمانكم',
                text: 'Chapter: Your supplication is your faith',
                translator: 891,
            },
        ];

        const actual = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(actual).toEqual([
            {
                from: 9,
                id: 'T3',
                lastUpdatedAt: 1764025085,
                nass: 'بدء الوحي',
                text: 'The Beginning of Revelation',
                translator: 891,
                children: [
                    {
                        from: 9,
                        id: 'T4',
                        lastUpdatedAt: 1764025085,
                        nass: 'باب كيف كان بدء الوحي إلى رسول الله',
                        text: 'Chapter: How the revelation began to the Messenger of Allah',
                        translator: 891,
                    },
                ],
            },
            {
                from: 17,
                id: 'T5',
                lastUpdatedAt: 1764025085,
                nass: 'كتاب الإيمان',
                text: 'Book of Faith',
                translator: 891,
                children: [
                    {
                        from: 17,
                        id: 'T6',
                        lastUpdatedAt: 1764025085,
                        nass: 'باب قول النبي ﷺ بني الإسلام على خمس',
                        text: 'Chapter: The Prophet\'s ﷺ statement "Islam is built upon five"',
                        translator: 891,
                    },
                    {
                        from: 18,
                        id: 'T7',
                        lastUpdatedAt: 1764025085,
                        nass: 'باب دعاؤكم إيمانكم',
                        text: 'Chapter: Your supplication is your faith',
                        translator: 891,
                    },
                ],
            },
        ]);
    });

    it('should map multiple root nodes without children', () => {
        const titleNodes: TitleNode[] = [
            { id: 1, page: 1, content: 'Chapter 1' },
            { id: 2, page: 5, content: 'Chapter 2' },
            { id: 3, page: 10, content: 'Chapter 3' },
        ];

        const headings: Heading[] = [
            { id: 'P1', nass: 'الفصل الأول', text: 'Chapter 1', translator: 890, lastUpdatedAt: 1000, from: 1 },
            { id: 'P2', nass: 'الفصل الثاني', text: 'Chapter 2', translator: 893, lastUpdatedAt: 2000, from: 5 },
            { id: 'P3', nass: 'الفصل الثالث', text: 'Chapter 3', translator: 879, lastUpdatedAt: 3000, from: 10 },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result).toHaveLength(3);
        expect(result[0].id).toBe('P1');
        expect(result[0].nass).toBe('الفصل الأول');
        expect(result[1].id).toBe('P2');
        expect(result[1].nass).toBe('الفصل الثاني');
        expect(result[2].id).toBe('P3');
        expect(result[2].nass).toBe('الفصل الثالث');
    });

    it('should map single root with one level of children', () => {
        const titleNodes: TitleNode[] = [
            {
                id: 1,
                page: 1,
                content: 'Chapter 1',
                children: [
                    { id: 2, page: 2, content: 'Section 1.1' },
                    { id: 3, page: 3, content: 'Section 1.2' },
                ],
            },
        ];

        const headings: Heading[] = [
            { id: 'P1', nass: 'الفصل الأول', text: 'Chapter 1', translator: 890, lastUpdatedAt: 1000, from: 1 },
            { id: 'P2', nass: 'القسم 1.1', text: 'Section 1.1', translator: 890, lastUpdatedAt: 1100, from: 2 },
            { id: 'P3', nass: 'القسم 1.2', text: 'Section 1.2', translator: 890, lastUpdatedAt: 1200, from: 3 },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result).toHaveLength(1);
        expect(result[0].nass).toBe('الفصل الأول');
        expect(result[0].children).toHaveLength(2);
        expect(result[0].children![0].nass).toBe('القسم 1.1');
        expect(result[0].children![0].text).toBe('Section 1.1');
        expect(result[0].children![1].nass).toBe('القسم 1.2');
        expect(result[0].children![1].text).toBe('Section 1.2');
    });

    it('should handle deeply nested structure (3+ levels)', () => {
        const titleNodes: TitleNode[] = [
            {
                id: 1,
                page: 1,
                content: 'Chapter 1',
                children: [
                    {
                        id: 2,
                        page: 2,
                        content: 'Section 1.1',
                        children: [
                            {
                                id: 3,
                                page: 3,
                                content: 'Subsection 1.1.1',
                                children: [{ id: 4, page: 4, content: 'Subsubsection 1.1.1.1' }],
                            },
                        ],
                    },
                ],
            },
        ];

        const headings: Heading[] = [
            { id: 'P1', nass: 'الفصل', text: 'Chapter 1', translator: 890, lastUpdatedAt: 1000, from: 1 },
            { id: 'P2', nass: 'القسم', text: 'Section 1.1', translator: 890, lastUpdatedAt: 2000, from: 2 },
            { id: 'P3', nass: 'القسم الفرعي', text: 'Subsection 1.1.1', translator: 890, lastUpdatedAt: 3000, from: 3 },
            {
                id: 'P4',
                nass: 'القسم الفرعي الفرعي',
                text: 'Subsubsection 1.1.1.1',
                translator: 890,
                lastUpdatedAt: 4000,
                from: 4,
            },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result).toHaveLength(1);
        expect(result[0].nass).toBe('الفصل');
        expect(result[0].children![0].nass).toBe('القسم');
        expect(result[0].children![0].children![0].nass).toBe('القسم الفرعي');
        expect(result[0].children![0].children![0].children![0].nass).toBe('القسم الفرعي الفرعي');
        expect(result[0].children![0].children![0].children![0].text).toBe('Subsubsection 1.1.1.1');
    });

    it('should handle multiple roots with nested children', () => {
        const titleNodes: TitleNode[] = [
            {
                id: 1,
                page: 1,
                content: 'Chapter 1',
                children: [
                    { id: 2, page: 2, content: 'Section 1.1' },
                    { id: 3, page: 3, content: 'Section 1.2' },
                ],
            },
            {
                id: 4,
                page: 5,
                content: 'Chapter 2',
                children: [{ id: 5, page: 6, content: 'Section 2.1' }],
            },
        ];

        const headings: Heading[] = [
            { id: 'P1', nass: 'الفصل 1', text: 'Chapter 1', translator: 890, lastUpdatedAt: 1000, from: 1 },
            { id: 'P2', nass: 'القسم 1.1', text: 'Section 1.1', translator: 890, lastUpdatedAt: 2000, from: 2 },
            { id: 'P3', nass: 'القسم 1.2', text: 'Section 1.2', translator: 890, lastUpdatedAt: 3000, from: 3 },
            { id: 'P4', nass: 'الفصل 2', text: 'Chapter 2', translator: 893, lastUpdatedAt: 4000, from: 5 },
            { id: 'P5', nass: 'القسم 2.1', text: 'Section 2.1', translator: 893, lastUpdatedAt: 5000, from: 6 },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result).toHaveLength(2);
        expect(result[0].nass).toBe('الفصل 1');
        expect(result[0].children).toHaveLength(2);
        expect(result[1].nass).toBe('الفصل 2');
        expect(result[1].children).toHaveLength(1);
        expect(result[1].children![0].nass).toBe('القسم 2.1');
    });

    it('should preserve all Heading properties including translator variations', () => {
        const titleNodes: TitleNode[] = [
            { id: 1, page: 1, content: 'Chapter 1' },
            { id: 2, page: 5, content: 'Chapter 2' },
        ];

        const headings: Heading[] = [
            {
                id: 'P1',
                nass: 'الفصل الأول',
                text: 'Chapter 1',
                translator: 890, // Gemini3
                lastUpdatedAt: 1609459200,
                from: 1,
            },
            {
                id: 'P2',
                nass: 'الفصل الثاني',
                text: 'Chapter 2',
                translator: 895, // Grok4Expert
                lastUpdatedAt: 1640995200,
                from: 5,
            },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result[0].translator).toBe(890);
        expect(result[0].lastUpdatedAt).toBe(1609459200);
        expect(result[1].translator).toBe(895);
        expect(result[1].lastUpdatedAt).toBe(1640995200);
    });

    it('should handle complex mixed hierarchy', () => {
        const titleNodes: TitleNode[] = [
            {
                id: 1,
                page: 1,
                content: 'Part 1',
                children: [
                    {
                        id: 2,
                        page: 2,
                        content: 'Chapter 1.1',
                        children: [
                            { id: 3, page: 3, content: 'Section 1.1.1' },
                            { id: 4, page: 4, content: 'Section 1.1.2' },
                        ],
                    },
                    { id: 5, page: 6, content: 'Chapter 1.2' },
                ],
            },
            { id: 6, page: 10, content: 'Part 2' },
        ];

        const headings: Heading[] = [
            { id: 'P1', nass: 'الجزء 1', text: 'Part 1', translator: 890, lastUpdatedAt: 1000, from: 1 },
            { id: 'P2', nass: 'الفصل 1.1', text: 'Chapter 1.1', translator: 890, lastUpdatedAt: 2000, from: 2 },
            { id: 'P3', nass: 'القسم 1.1.1', text: 'Section 1.1.1', translator: 890, lastUpdatedAt: 3000, from: 3 },
            { id: 'P4', nass: 'القسم 1.1.2', text: 'Section 1.1.2', translator: 890, lastUpdatedAt: 4000, from: 4 },
            { id: 'P5', nass: 'الفصل 1.2', text: 'Chapter 1.2', translator: 890, lastUpdatedAt: 5000, from: 6 },
            { id: 'P6', nass: 'الجزء 2', text: 'Part 2', translator: 893, lastUpdatedAt: 6000, from: 10 },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result).toHaveLength(2);

        // Part 1 structure
        expect(result[0].nass).toBe('الجزء 1');
        expect(result[0].children).toHaveLength(2);
        expect(result[0].children![0].nass).toBe('الفصل 1.1');
        expect(result[0].children![0].children).toHaveLength(2);
        expect(result[0].children![0].children![0].nass).toBe('القسم 1.1.1');
        expect(result[0].children![0].children![1].nass).toBe('القسم 1.1.2');
        expect(result[0].children![1].nass).toBe('الفصل 1.2');
        expect(result[0].children![1].children).toBeUndefined();

        // Part 2 structure
        expect(result[1].nass).toBe('الجزء 2');
        expect(result[1].children).toBeUndefined();
    });

    it('should correctly map heading IDs that use P prefix', () => {
        const titleNodes: TitleNode[] = [{ id: 123, page: 1, content: 'Chapter' }];

        const headings: Heading[] = [
            { id: 'P123', nass: 'الفصل', text: 'Chapter', translator: 890, lastUpdatedAt: 1000, from: 1 },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result[0].id).toBe('P123');
        expect(result[0].nass).toBe('الفصل');
    });

    it('should maintain tree structure integrity with unbalanced children', () => {
        const titleNodes: TitleNode[] = [
            {
                id: 1,
                page: 1,
                content: 'Root 1',
                children: [{ id: 2, page: 2, content: 'Child 1' }],
            },
            {
                id: 3,
                page: 5,
                content: 'Root 2',
                children: [
                    { id: 4, page: 6, content: 'Child 1' },
                    { id: 5, page: 7, content: 'Child 2' },
                    { id: 6, page: 8, content: 'Child 3' },
                ],
            },
        ];

        const headings: Heading[] = [
            { id: 'P1', nass: 'جذر 1', text: 'Root 1', translator: 890, lastUpdatedAt: 1000, from: 1 },
            { id: 'P2', nass: 'طفل 1', text: 'Child 1', translator: 890, lastUpdatedAt: 2000, from: 2 },
            { id: 'P3', nass: 'جذر 2', text: 'Root 2', translator: 893, lastUpdatedAt: 3000, from: 5 },
            { id: 'P4', nass: 'طفل 1', text: 'Child 1', translator: 893, lastUpdatedAt: 4000, from: 6 },
            { id: 'P5', nass: 'طفل 2', text: 'Child 2', translator: 893, lastUpdatedAt: 5000, from: 7 },
            { id: 'P6', nass: 'طفل 3', text: 'Child 3', translator: 893, lastUpdatedAt: 6000, from: 8 },
        ];

        const result = mapTitleTreeToHeadingTree(titleNodes, headings);

        expect(result[0].children).toHaveLength(1);
        expect(result[1].children).toHaveLength(3);
    });
});
