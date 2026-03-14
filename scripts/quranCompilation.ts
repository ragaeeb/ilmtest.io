import type { Collection, Compilation, Excerpt, Heading } from '@/types/excerpts';

type RawCompilation = Omit<Compilation, 'collection' | 'sourceDocument' | 'headings' | 'excerpts' | 'footnotes'> & {
    collection?: Collection;
    sourceDocument?: Compilation['sourceDocument'];
    headings: Array<
        Partial<Heading> & {
            id?: string;
            nass: string;
            text: string;
            meta?: Record<string, unknown>;
        }
    >;
    excerpts: Array<
        Partial<Excerpt> & {
            id?: string;
            nass: string;
            text: string;
            meta?: Record<string, unknown>;
        }
    >;
    footnotes?: Excerpt[];
};

type LoadedCompilation = {
    data: Compilation;
    explicitSectionToExcerpts?: Record<string, string[]>;
    explicitExcerptToSection?: Record<string, string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const getUnixNow = () => Math.floor(Date.now() / 1000);

const getCompilationTimestamp = (compilation: RawCompilation) =>
    compilation.lastUpdatedAt ?? compilation.createdAt ?? getUnixNow();

const getQuranHeadingNumber = (heading: RawCompilation['headings'][number], index: number) => {
    const meta = heading.meta;
    if (isRecord(meta) && typeof meta.num === 'number' && Number.isInteger(meta.num) && meta.num > 0) {
        return meta.num;
    }

    return index + 1;
};

const getExcerptHeadingId = (excerpt: RawCompilation['excerpts'][number]) => {
    const meta = excerpt.meta;
    if (isRecord(meta) && typeof meta.headingId === 'string' && meta.headingId.trim()) {
        return meta.headingId.trim();
    }

    return null;
};

export const normalizeQuranCompilation = (compilation: RawCompilation, collection: Collection): LoadedCompilation => {
    const timestamp = getCompilationTimestamp(compilation);
    const normalizedHeadings = compilation.headings.map((heading, index) => {
        const surahNumber = getQuranHeadingNumber(heading, index);
        return {
            id: heading.id ?? `T${surahNumber}`,
            nass: heading.nass,
            text: heading.text,
            from: typeof heading.from === 'number' ? heading.from : surahNumber,
            translator: heading.translator ?? 0,
            lastUpdatedAt: heading.lastUpdatedAt ?? timestamp,
        } satisfies Heading;
    });

    const headingById = new Map(
        normalizedHeadings.map((heading, index) => [
            heading.id,
            {
                heading,
                surah: getQuranHeadingNumber(compilation.headings[index]!, index),
            },
        ]),
    );
    const excerptCountByHeading = new Map<string, number>();
    const sectionToExcerpts: Record<string, string[]> = {};
    const excerptToSection: Record<string, string> = {};
    for (const heading of normalizedHeadings) {
        sectionToExcerpts[heading.id] = [];
    }

    const normalizedExcerpts = compilation.excerpts.map((excerpt) => {
        const headingId = getExcerptHeadingId(excerpt);
        if (!headingId) {
            throw new Error('Qur’an excerpt missing meta.headingId');
        }

        const entry = headingById.get(headingId);
        if (!entry) {
            throw new Error(`unknown headingId ${headingId}`);
        }

        const nextCount = (excerptCountByHeading.get(headingId) ?? 0) + 1;
        excerptCountByHeading.set(headingId, nextCount);

        const ayahNumber = nextCount;
        const excerptId = `${headingId}-${ayahNumber}`;
        sectionToExcerpts[headingId].push(excerptId);
        excerptToSection[excerptId] = headingId;

        return {
            id: excerptId,
            nass: excerpt.nass,
            text: excerpt.text,
            from: typeof excerpt.from === 'number' ? excerpt.from : entry.surah,
            translator: excerpt.translator ?? 0,
            lastUpdatedAt: excerpt.lastUpdatedAt ?? timestamp,
            meta: {
                ...(isRecord(excerpt.meta) ? excerpt.meta : {}),
                surah: entry.surah,
                ayah: ayahNumber,
            },
        } satisfies Excerpt;
    });

    return {
        data: {
            contractVersion: compilation.contractVersion,
            createdAt: compilation.createdAt ?? timestamp,
            lastUpdatedAt: compilation.lastUpdatedAt ?? timestamp,
            collection,
            sourceDocument: (compilation.sourceDocument ?? {}) as Compilation['sourceDocument'],
            headings: normalizedHeadings,
            excerpts: normalizedExcerpts,
            footnotes: compilation.footnotes ?? [],
        },
        explicitSectionToExcerpts: sectionToExcerpts,
        explicitExcerptToSection: excerptToSection,
    };
};

export type { LoadedCompilation, RawCompilation };
