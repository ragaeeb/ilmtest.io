import { describe, expect, it } from 'bun:test';
import { runRouteSmoke } from './smokeRoutes';

const hasFixture = await Bun.file('src/data/collections.json').exists();

describe('route smoke', () => {
    if (!hasFixture) {
        it.skip('skipped (no fixture corpus materialized)', () => {});
        return;
    }

    it(
        'serves collection, section, and excerpt routes',
        async () => {
            const result = await runRouteSmoke(undefined, 4372);
            expect(result.routeCount).toBeGreaterThan(0);
        },
        60_000,
    );
});
