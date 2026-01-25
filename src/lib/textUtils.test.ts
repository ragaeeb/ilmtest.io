import { describe, expect, it } from 'bun:test';
import { arabicToWestern, slugify } from './textUtils';

describe('slugify', () => {
    it('returns empty string for no input', () => {
        expect(slugify()).toBe('');
    });

    it('uses first two meaningful title words', () => {
        expect(slugify('Fatāwá ʿIbar al-Hātif wa-ʿl-Sayyārah')).toBe('fatawa-ibar');
    });

    it('keeps stopwords if the title is only stopwords', () => {
        expect(slugify('al wa fi')).toBe('al-fi');
    });

    it('normalizes diacritics and prefixes for titles', () => {
        expect(slugify('Ṣaḥīḥ al-Bukhārī')).toBe('sahih-bukhari');
    });

    it('uses last name for author and strips prefixes', () => {
        expect(slugify('Fatāwá ʿIbar al-Hātif wa-ʿl-Sayyārah', 'Muḥammad Nāṣir ʾl-Dīn al-Albānī')).toBe(
            'fatawa-ibar-albani',
        );
    });

    it('handles single-word author names', () => {
        expect(slugify('Siyar Aʿlām al-Nubalā', 'al-Dhahabī')).toBe('siyar-alam-dhahabi');
    });

    it('removes punctuation and extra spacing', () => {
        expect(slugify('Kitāb: al-Ḥudūd!', 'Ibn Ḥajar')).toBe('kitab-hudud-hajar');
    });
});

describe('arabicToWestern', () => {
    it.each([
        ['١', 1],
        ['٥', 5],
        ['٩', 9],
    ])('should convert single digit %s to %i', (arabic, expected) => {
        expect(arabicToWestern(arabic)).toBe(expected);
    });

    it.each([
        ['٤٩', 49],
        ['١٢', 12],
    ])('should convert double digits %s to %i', (arabic, expected) => {
        expect(arabicToWestern(arabic)).toBe(expected);
    });

    it.each([
        ['٧٥٦٣', 7563],
        ['١٢٣٤', 1234],
    ])('should convert large numbers %s to %i', (arabic, expected) => {
        expect(arabicToWestern(arabic)).toBe(expected);
    });

    it.each([
        ['٠', 0],
        ['١٠', 10],
    ])('should handle zero in %s → %i', (arabic, expected) => {
        expect(arabicToWestern(arabic)).toBe(expected);
    });

    it('should convert Arabic numerals to Western', () => {
        expect(arabicToWestern('٥٩')).toBe(59);
        expect(arabicToWestern('١٢٣٤')).toBe(1234);
        expect(arabicToWestern('٠')).toBe(0);
    });

    it('should handle already Western numerals', () => {
        expect(arabicToWestern('59')).toBe(59);
    });
});
