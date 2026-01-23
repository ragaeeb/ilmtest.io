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
    /** One or more authors of this collection. It can be */
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

/**
 * Segmentations from the collection. These can be individual pages, or even further granular segments from within those long pages. Each of these segments
 * can represent an ayah, an individual hadith, a singular narration from an entire page, a paragraph, or a paragraph that spans from one page to another in
 * a book.
 */
export type Excerpts = {
    /** The original data/content the excerpts were segmented from if required to map additional metadata. This is useful in case we need to apply certain things to add proper citations to an excerpt like volume number and page number. Since web pages just have a unique id to the article, generally these won't be available for scraped pages since we don't need that mapping */
    asl: ScrapeResult | ;

    /** Collection associated with these excerpts */
    collection: Collection;
    /** Contract version for format compatibility to handle breaking changes. */
    contractVersion: string;
    /** Timestamp when created. Generated using Date.now()/1000 */
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

enum AITranslator {
    Gemini3 = 890,
    OpenAIGpt52Thinking = 893,
    OpenAIGpt5 = 879,
    Grok4Expert = 895,
}

type AITranslation = {
    /** The translated nass. */
    text: string;

    /** The AI model that translated it. */
    translator: AITranslator;

    /** The last time this translation was updated (Unix timestamp in seconds). */
    lastUpdatedAt: number;
};

export enum MarkerMetaType {
    Book = 'B',
    Chapter = 'C',
}

type BookMeta = {
    /** Optional marker the client can use to style the excerpt a different way to signify it's a chapter heading or book heading vs. regular body paragraph text */
    type?: MarkerMetaType;

    /** Page within volume (ie: if a citation was Majmu' al-Fatawa 1/33, vp=33) */
    vp?: number;

    /** Volume number citation (ie: If a citation was Majmu' al-Fatawa 1/33, vol=1) */
    vol: number;
};

type HadithMetadata = {
    /** The number of the hadith. If we're looking at Sahih al-Bukhari #59, num="٥٩" */
    num: string;
};

type ArabicAsl = {
    /** The Arabic text of the excerpt */
    nass: string;

    /** Unique ID of this excerpt */
    id: string;

    /** The unique page number id from the Collection this excerpt was segmented from. This will be the :page value the citationTemplate will be replaced with */
    from: number;
};

/**
 * Headings (from books) and titles (from website posts) to display in a table of contents for each book.
 */
export type Heading = ArabicAsl & AITranslation;

/**
 * A segmented excerpt from a collection. This can be a single page from the entire book, a paragraph, a single line from a page, a hadith, an ayah from the Qur'an. Each excerpt should be shareable via a link directly to it. A set of excerpts are organized under a single Heading.
 *
 * Example: headings = [{id: 'C1', from: 1}, {id: 'C2', from: 3}]
 * excerpts = [{id: 'P1', from: 1}, {id: 'P2', from: 1}, {id: 'P3', from: 2}, {id: 'P4', from: 3}]
 * That means P1,P2,P3 would show up in a page when the user clicks C1 in the table of contents.
 * If they clicked C2 in the TOC, only P4 should show up.
 * Similarly if the user were to open a direct link to the P1 excerpt, it should show a heading before its text to signify it is under the C1 chapter title.
 * If they opened up P4 they would see that it is classified under C2.
 */
export type Excerpt = ArabicAsl & AITranslation & {
    meta?: BookMeta | HadithMetadata;
};
