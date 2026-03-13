import { describe, expect, it } from 'bun:test';
import type { ObjectStore } from './datasetControl';
import {
    buildDatasetVersionBase,
    buildDefaultReleaseLabel,
    formatLocalDate,
    parseCollectionIds,
    sanitizeReleaseLabel,
    suggestDatasetVersion,
} from './publishGuided';

const createStore = (existingDatasetVersions: string[]): ObjectStore => ({
    async putObject() {},
    async getObject() {
        return null;
    },
    async headObject(key) {
        return existingDatasetVersions.some((datasetVersion) => key === `datasets/${datasetVersion}/manifest.json`)
            ? { key, bytes: 1 }
            : null;
    },
    async listObjects() {
        return [];
    },
    async deleteObject() {},
});

describe('publishGuided helpers', () => {
    it('parses space and comma separated collection IDs and removes duplicates', () => {
        expect(parseCollectionIds('2572, 2573 2574 2572')).toEqual(['2572', '2573', '2574']);
    });

    it('rejects invalid collection IDs', () => {
        expect(() => parseCollectionIds('2572 foo')).toThrow('Collection IDs must be numeric');
    });

    it('builds a sensible default release label', () => {
        expect(buildDefaultReleaseLabel(['2572'])).toBe('book-2572');
        expect(buildDefaultReleaseLabel(['2572', '2573', '2574'])).toBe('pilot-books3');
    });

    it('sanitizes release labels into stable slugs', () => {
        expect(sanitizeReleaseLabel(' Pilot Books 12 ')).toBe('pilot-books-12');
    });

    it('formats the local date for dataset versions', () => {
        expect(formatLocalDate(new Date('2026-03-13T12:30:00Z'))).toBe('2026-03-13');
    });

    it('builds the dataset version base from the release label', () => {
        expect(buildDatasetVersionBase('pilot-books12', new Date('2026-03-13T12:30:00Z'))).toBe(
            '2026-03-13-pilot-books12',
        );
    });

    it('suggests the next available dataset version', async () => {
        const datasetVersion = await suggestDatasetVersion(
            createStore(['2026-03-13-pilot-books12-v1', '2026-03-13-pilot-books12-v2']),
            'pilot-books12',
            new Date('2026-03-13T12:30:00Z'),
        );

        expect(datasetVersion).toBe('2026-03-13-pilot-books12-v3');
    });
});
