import { describe, expect, it } from 'bun:test';
import { slugify } from './textUtils';

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
