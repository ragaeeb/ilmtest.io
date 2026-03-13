import { describe, expect, it } from 'bun:test';
import { assertDatasetPointer, getDatasetPointerKey, isDatasetPointer } from './datasetPointer';

describe('datasetPointer', () => {
    it('accepts a valid pointer payload', () => {
        const pointer = {
            datasetVersion: '2026-03-12T18-42-10Z-abc1234',
            manifestKey: 'datasets/2026-03-12T18-42-10Z-abc1234/manifest.json',
            publishedAt: '2026-03-12T18:42:10.000Z',
            notes: 'Preview rollout',
        };

        expect(isDatasetPointer(pointer)).toBe(true);
        expect(assertDatasetPointer(pointer)).toEqual(pointer);
    });

    it('rejects invalid pointer payloads', () => {
        expect(
            isDatasetPointer({
                datasetVersion: '',
                manifestKey: 'datasets/v1/manifest.json',
                publishedAt: 'not-a-date',
            }),
        ).toBe(false);
        expect(
            isDatasetPointer({
                datasetVersion: '2026-03-12T18-42-10Z-abc1234',
                manifestKey: 'datasets/v1/manifest.json',
                publishedAt: 'March 12, 2026',
            }),
        ).toBe(false);
    });

    it('builds channel pointer keys', () => {
        expect(getDatasetPointerKey('prod')).toBe('channels/prod.json');
        expect(getDatasetPointerKey('preview')).toBe('channels/preview.json');
    });
});
