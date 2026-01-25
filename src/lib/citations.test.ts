import { describe, expect, it } from 'bun:test';
import type { Collection, Excerpt } from '../scripts/types/excerpts';
import { arabicToWestern } from './arabic';
import {
    formatAnonymousCitation,
    formatAuthorName,
    formatBookCitation,
    formatCitation,
    formatHadithCitation,
    formatQuranCitation,
    getCitationType,
    getCitationUrl,
} from './citations';

// Mock collection factory
const createCollection = (overrides: Partial<Collection> = {}): Collection => ({
    id: '2576',
    authors: [{ id: '1', name: 'al-Bukhārī', ism: 'البخاري', img: '' }],
    roman: 'Ṣaḥīḥ',
    src: { id: '75', fid: '2576' },
    slug: 'sahih-bukhari',
    citationTemplate: 'https://shamela.ws/book/2576/:page',
    unwan: 'صحيح البخاري',
    ...overrides,
});

// Mock excerpt factory
const createExcerpt = (overrides: Partial<Excerpt> = {}): Excerpt => ({
    id: 'P1',
    from: 59,
    nass: 'النص العربي',
    text: 'English translation',
    translator: 890,
    lastUpdatedAt: Date.now() / 1000,
    ...overrides,
});

describe('getCitationType', () => {
    it('should return hadith for num metadata', () => {
        const excerpt = createExcerpt({ meta: { num: '٥٩' } });
        expect(getCitationType(excerpt)).toBe('hadith');
    });

    it('should return book for vol metadata', () => {
        const excerpt = createExcerpt({ meta: { vol: 2, vp: 93 } });
        expect(getCitationType(excerpt)).toBe('book');
    });

    it('should return quran for surah/ayah metadata', () => {
        const excerpt = createExcerpt({ meta: { surah: 2, ayah: 103 } as any });
        expect(getCitationType(excerpt)).toBe('quran');
    });

    it('should return web for url metadata', () => {
        const excerpt = createExcerpt({ meta: { url: 'https://example.com' } as any });
        expect(getCitationType(excerpt)).toBe('web');
    });

    it('should return unknown for no metadata', () => {
        const excerpt = createExcerpt({ meta: undefined });
        expect(getCitationType(excerpt)).toBe('unknown');
    });
});

describe('formatAuthorName', () => {
    it('should return empty string for no authors', () => {
        const collection = createCollection({ authors: [] });
        expect(formatAuthorName(collection)).toBe('');
    });

    it('should return single author name', () => {
        const collection = createCollection();
        expect(formatAuthorName(collection)).toBe('al-Bukhārī');
    });

    it('should return first author with et al. for multiple authors', () => {
        const collection = createCollection({
            authors: [
                { id: '1', name: 'Ibn Kathīr', ism: 'ابن كثير' },
                { id: '2', name: 'al-Suyūṭī', ism: 'السيوطي' },
            ],
        });
        expect(formatAuthorName(collection)).toBe('Ibn Kathīr et al.');
    });
});

describe('arabicToWestern', () => {
    it('should convert Arabic numerals to Western', () => {
        expect(arabicToWestern('٥٩')).toBe(59);
        expect(arabicToWestern('١٢٣٤')).toBe(1234);
        expect(arabicToWestern('٠')).toBe(0);
    });

    it('should handle already Western numerals', () => {
        expect(arabicToWestern('59')).toBe(59);
    });
});

describe('formatHadithCitation', () => {
    it('should format hadith citation with author', () => {
        const excerpt = createExcerpt({ meta: { num: '٥٩' } });
        const collection = createCollection();

        const result = formatHadithCitation(excerpt, collection);
        expect(result).toBe('al-Bukhārī, Ṣaḥīḥ #59');
    });

    it('should format hadith citation without author', () => {
        const excerpt = createExcerpt({ meta: { num: '٥٩' } });
        const collection = createCollection({ authors: [] });

        const result = formatHadithCitation(excerpt, collection);
        expect(result).toBe('Ṣaḥīḥ #59');
    });
});

describe('formatBookCitation', () => {
    it('should format book citation with volume and page', () => {
        const excerpt = createExcerpt({ from: 156, meta: { vol: 2, vp: 93 } });
        const collection = createCollection({
            authors: [{ id: '1', name: 'al-Dhahabī', ism: 'الذهبي' }],
            roman: 'Siyar Aʿlām al-Nubalā',
            citationTemplate: 'https://shamela.ws/book/5678/:page',
        });

        const result = formatBookCitation(excerpt, collection);
        expect(result).toBe('al-Dhahabī, Siyar Aʿlām al-Nubalā 2/93');
    });

    it('should format book citation with volume only', () => {
        const excerpt = createExcerpt({ from: 156, meta: { vol: 2 } });
        const collection = createCollection({
            authors: [{ id: '1', name: 'al-Dhahabī', ism: 'الذهبي' }],
            roman: 'Siyar',
        });

        const result = formatBookCitation(excerpt, collection);
        expect(result).toContain('Siyar 2');
    });
});

describe('formatQuranCitation', () => {
    it('should format Quran citation with surah name', () => {
        const excerpt = createExcerpt({
            from: 103,
            meta: { surah: 2, ayah: 103, surahName: 'al-Baqarah' } as any,
        });
        const collection = createCollection({
            authors: [],
            roman: 'al-Qurʾān',
            citationTemplate: 'https://quran.com/:surah/:ayah',
        });

        const result = formatQuranCitation(excerpt, collection);
        expect(result).toBe('al-Baqarah 2:103');
    });

    it('should format Quran citation without surah name', () => {
        const excerpt = createExcerpt({
            from: 103,
            meta: { surah: 2, ayah: 103 } as any,
        });
        const collection = createCollection({
            authors: [],
            citationTemplate: 'https://quran.com/:surah/:ayah',
        });

        const result = formatQuranCitation(excerpt, collection);
        expect(result).toBe('Surah 2 2:103');
    });
});

describe('formatAnonymousCitation', () => {
    it('should format anonymous citation with title only', () => {
        const excerpt = createExcerpt({ from: 5 });
        const collection = createCollection({
            authors: [],
            roman: 'Kitāb al-Ḥikam',
            citationTemplate: 'https://shamela.ws/book/1234/:page',
        });

        const result = formatAnonymousCitation(excerpt, collection);
        expect(result).toBe('Kitāb al-Ḥikam');
    });
});

describe('formatCitation', () => {
    it('should auto-detect hadith type and format', () => {
        const excerpt = createExcerpt({ meta: { num: '٥٩' } });
        const collection = createCollection();

        const result = formatCitation(excerpt, collection);
        expect(result).toContain('#59');
    });

    it('should auto-detect book type and format', () => {
        const excerpt = createExcerpt({ meta: { vol: 2, vp: 93 } });
        const collection = createCollection();

        const result = formatCitation(excerpt, collection);
        expect(result).toContain('2/93');
    });

    it('should fallback to anonymous for unknown type', () => {
        const excerpt = createExcerpt({ meta: undefined });
        const collection = createCollection({ authors: [] });

        const result = formatCitation(excerpt, collection);
        expect(result).toContain('[Ṣaḥīḥ](');
    });
});

describe('getCitationUrl', () => {
    it('should return correct URL', () => {
        const excerpt = createExcerpt({ from: 59 });
        const collection = createCollection();

        const result = getCitationUrl(excerpt, collection);
        expect(result).toBe('https://shamela.ws/book/2576/59');
    });
});
