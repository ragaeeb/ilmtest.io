import type { Collection, Excerpt } from '@/types/excerpts';
import { arabicToWestern } from './textUtils';

/**
 * Citation metadata types using discriminated unions for type safety.
 */
export type CitationMeta =
    | { type: 'hadith'; num: string }
    | { type: 'book'; vol: number; page?: number }
    | { type: 'quran'; surah: number; ayah: number; surahName?: string }
    | { type: 'web'; url: string }
    | { type: 'unknown' };

type HadithCitationMeta = Extract<CitationMeta, { type: 'hadith' }>;
type BookCitationMeta = Extract<CitationMeta, { type: 'book' }>;
type QuranCitationMeta = Extract<CitationMeta, { type: 'quran' }>;
type WebCitationMeta = Extract<CitationMeta, { type: 'web' }>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const getCitationMeta = (excerpt: Excerpt): CitationMeta => {
    const meta = excerpt.meta;

    if (!isRecord(meta)) {
        return { type: 'unknown' };
    }

    if ('num' in meta && typeof meta.num === 'string') {
        return { type: 'hadith', num: meta.num };
    }

    if ('vol' in meta && typeof meta.vol === 'number') {
        return {
            type: 'book',
            vol: meta.vol,
            page: 'vp' in meta && typeof meta.vp === 'number' ? meta.vp : undefined,
        };
    }

    if ('surah' in meta && typeof meta.surah === 'number' && 'ayah' in meta && typeof meta.ayah === 'number') {
        return {
            type: 'quran',
            surah: meta.surah,
            ayah: meta.ayah,
            surahName: 'surahName' in meta && typeof meta.surahName === 'string' ? meta.surahName : undefined,
        };
    }

    if ('url' in meta && typeof meta.url === 'string') {
        return { type: 'web', url: meta.url };
    }

    return { type: 'unknown' };
};

/**
 * Get citation type from excerpt metadata.
 */
export const getCitationType = (excerpt: Excerpt): CitationMeta['type'] => {
    return getCitationMeta(excerpt).type;
};

/**
 * Format author name(s) for citation.
 * - Single author: "Ibn Taymiyyah"
 * - Multiple authors: "Ibn Kathīr et al."
 * - No authors: empty string
 */
export const formatAuthorName = (collection: Collection): string => {
    if (collection.authors.length === 0) {
        return '';
    }

    if (collection.authors.length === 1) {
        return collection.authors[0].name;
    }

    return `${collection.authors[0].name} et al.`;
};

/**
 * Format hadith citation.
 * Example: "[al-Bukhārī, Ṣaḥīḥ #59](https://shamela.ws/book/2576/59)"
 */
export const formatHadithCitation = (excerpt: Excerpt, collection: Collection): string => {
    const author = formatAuthorName(collection);
    const title = collection.roman;
    const meta = getCitationMeta(excerpt) as HadithCitationMeta;
    const num = arabicToWestern(meta.num);
    if (author) {
        return `${author}, ${title} #${num}`;
    }
    return `${title} #${num}`;
};

/**
 * Format book citation with volume and page.
 * Example: "[al-Dhahabī, Siyar Aʿlām al-Nubalā 2/93](https://shamela.ws/book/5678/156)"
 */
export const formatBookCitation = (excerpt: Excerpt, collection: Collection): string => {
    const author = formatAuthorName(collection);
    const title = collection.roman;
    const meta = getCitationMeta(excerpt) as BookCitationMeta;

    const volPage = meta.page ? `${meta.vol}/${meta.page}` : `${meta.vol}`;

    if (author) {
        return `${author}, ${title} ${volPage}`;
    }
    return `${title} ${volPage}`;
};

/**
 * Format Qur'an citation.
 * Example: "[al-Baqarah 2:103](https://quran.com/2/103)"
 */
export const formatQuranCitation = (excerpt: Excerpt, collection: Collection): string => {
    void collection;
    const meta = getCitationMeta(excerpt) as QuranCitationMeta;
    const surahDisplay = meta.surahName || `Surah ${meta.surah}`;
    return `${surahDisplay} ${meta.surah}:${meta.ayah}`;
};

/**
 * Format web citation.
 * Example: "[Title](https://example.com/article)"
 */
export const formatWebCitation = (excerpt: Excerpt, collection: Collection): string => {
    void excerpt;
    const title = collection.roman;
    const author = formatAuthorName(collection);

    if (author) {
        return `${title}, ${author}`;
    }
    return `${title}`;
};

/**
 * Format anonymous/unknown citation (title only).
 * Example: "[Kitāb al-Ḥikam](https://shamela.ws/book/1234/5)"
 */
export const formatAnonymousCitation = (excerpt: Excerpt, collection: Collection): string => {
    void excerpt;
    const title = collection.roman;
    const author = formatAuthorName(collection);
    if (author) {
        return `${title}, ${author}`;
    }
    return `${title}`;
};

export type CitationParts = {
    label: string;
    url: string;
};

export const getCitationParts = (excerpt: Excerpt, collection: Collection): CitationParts => {
    const meta = getCitationMeta(excerpt);

    switch (meta.type) {
        case 'hadith':
            return {
                label: formatHadithCitation(excerpt, collection),
                url: collection.citationTemplate.replace(':page', excerpt.from.toString()),
            };
        case 'book':
            return {
                label: formatBookCitation(excerpt, collection),
                url: collection.citationTemplate.replace(':page', excerpt.from.toString()),
            };
        case 'quran': {
            return {
                label: formatQuranCitation(excerpt, collection),
                url: collection.citationTemplate
                    .replace(':page', excerpt.from.toString())
                    .replace(':surah', meta.surah.toString())
                    .replace(':ayah', meta.ayah.toString()),
            };
        }
        case 'web': {
            const webMeta = meta as WebCitationMeta;
            return {
                label: formatWebCitation(excerpt, collection),
                url: webMeta.url,
            };
        }
        case 'unknown':
            return {
                label: formatAnonymousCitation(excerpt, collection),
                url: collection.citationTemplate.replace(':page', excerpt.from.toString()),
            };
    }
};

/**
 * Format citation based on excerpt type and collection metadata.
 * Handles hadith, book, Qur'an, web, and anonymous sources.
 */
export const formatCitation = (excerpt: Excerpt, collection: Collection): string => {
    const { label, url } = getCitationParts(excerpt, collection);
    return `[${label}](${url})`;
};

/**
 * Get the raw citation URL for an excerpt.
 */
export const getCitationUrl = (excerpt: Excerpt, collection: Collection): string => {
    const { url } = getCitationParts(excerpt, collection);
    return url;
};
