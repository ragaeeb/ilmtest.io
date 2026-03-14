import type { BookData } from 'shamela';
import type { ScrapeResult } from './asl';

/**
 * A "person", who can be an author, a narrator, etc.
 */
export type Entity = {
    /** Transliterated roman name in English. */
    name: string;

    id: string;

    /** Arabic name */
    ism: string;

    /** URL */
    img?: string;
};

type Library = {
    /** Unique id for this library: shamela4 */
    id: string;

    /** Unique id for this collection within that library. */
    fid: string;
};

/**
 * A collection of excerpts. This can be a book, or a website of articles/pages that was scraped.
 */
export type Collection = {
    /** One or more authors of this collection. */
    authors: Entity[];

    /** ALC-LC transliterated title. */
    roman: string;

    /** The external library/website this book and content was scraped or downloaded from. */
    src: Library;

    /** Unique slug to appear in the public route. */
    slug: string;

    /** A URL template like https://shamela.ws/book/1234/:page where the page of an excerpt will be substituted to produce the citation */
    citationTemplate: string;

    /** The Arabic title of the book/work. */
    unwan: string;

    id: string;
};

/** The original data/content the excerpts were segmented from. Useful to rebuild the the table of contents hierarchy and get additional citation metadata. */
export type SourceDocument = ScrapeResult | BookData;

/**
 * Segmentations from the collection.
 */
export type Compilation = {
    sourceDocument: SourceDocument;

    /** Collection associated with these excerpts */
    collection: Collection;
    /** Contract version for format compatibility. */
    contractVersion: string;
    /** Timestamp when created. */
    createdAt: number;
    /** All excerpt entries */
    excerpts: Excerpt[];
    /** All footnotes */
    footnotes: Excerpt[];
    /** All headings/sections */
    headings: Heading[];
    /** Timestamp when last updated. */
    lastUpdatedAt: number;
};

type AITranslation = {
    /** The translated nass. */
    text: string;

    /** The AI model that translated it. */
    translator: number;

    /** The last time this translation was updated (Unix timestamp in seconds). */
    lastUpdatedAt: number;
};

export enum MarkerMetaType {
    Book = 'B',
    Chapter = 'C',
}

type BookMeta = {
    /** Optional marker for styling */
    type?: MarkerMetaType;

    /** Page within volume */
    vp?: number;

    /** Volume number citation */
    vol: number;
};

type HadithMetadata = {
    /** The number of the hadith. */
    num: string;
};

type QuranMeta = {
    /** Surah number in the Qur'an citation. */
    surah: number;

    /** Ayah number in the Qur'an citation. */
    ayah: number;

    /** Optional transliterated or English surah label. */
    surahName?: string;
};

type WebMeta = {
    /** Canonical source URL for scraped/web content. */
    url: string;
};

type HeadingReferenceMeta = {
    /** Explicit heading/section membership for sources that do not need page-based inference. */
    headingId: string;
};

type ArabicAsl = {
    /** The Arabic text of the excerpt */
    nass: string;

    /** Unique ID of this excerpt */
    id: string;

    /** The unique page number id from the Collection this excerpt was segmented from. */
    from: number;
};

/**
 * Headings (from books) and titles (from website posts) to display in a table of contents for each book.
 */
export type Heading = ArabicAsl & AITranslation;

/**
 * A segmented excerpt from a collection.
 */
export type Excerpt = ArabicAsl &
    AITranslation & {
        meta?: BookMeta | HadithMetadata | QuranMeta | WebMeta | HeadingReferenceMeta;
    };
