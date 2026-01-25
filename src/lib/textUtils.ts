/**
 * Generate a URL-safe slug
 */
import { normalizeSpaces, normalizeTransliteratedEnglish } from 'bitaboom';

const TITLE_STOPWORDS = new Set(['al', 'wa', 'w', 'fi', 'bi', 'li', 'l']);

const toSlugTokens = (text: string): string[] => {
    const normalized = normalizeTransliteratedEnglish(text);
    const cleaned = normalized.replace(/[^a-zA-Z0-9]+/g, ' ');
    const compact = normalizeSpaces(cleaned).trim();
    if (!compact) {
        return [];
    }
    return compact
        .split(' ')
        .map((token) => token.toLowerCase())
        .filter(Boolean);
};

const pickTitleTokens = (title: string): string[] => {
    const tokens = toSlugTokens(title);
    if (tokens.length === 0) {
        return [];
    }
    const filtered = tokens.filter((token) => !TITLE_STOPWORDS.has(token));
    const base = filtered.length >= 2 ? filtered : tokens;
    return base.slice(0, Math.min(2, base.length));
};

const pickAuthorToken = (author: string): string | null => {
    const rawTokens = normalizeSpaces(author).split(' ').filter(Boolean);
    if (rawTokens.length === 0) {
        return null;
    }
    const last = rawTokens[rawTokens.length - 1];
    const normalizedLast = toSlugTokens(last).join('-');
    return normalizedLast || null;
};

export const slugify = (title?: string, author?: string) => {
    const parts: string[] = [];

    if (title) {
        parts.push(...pickTitleTokens(title));
    }

    if (author) {
        const authorToken = pickAuthorToken(author);
        if (authorToken) {
            parts.push(authorToken);
        }
    }

    return parts.join('-');
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
    const western = arabicNum.replace(/[٠-٩]/g, (digit) => ARABIC_TO_WESTERN[digit]);
    return Number.parseInt(western, 10);
};
