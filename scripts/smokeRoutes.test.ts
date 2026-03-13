import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:net';
import { runRouteSmoke } from './smokeRoutes';

const hasFixture = await Bun.file('src/data/collections.json').exists();

const getAvailablePort = async () =>
    await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Failed to allocate an ephemeral port'));
                return;
            }

            const { port } = address;
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });

describe('route smoke', () => {
    if (!hasFixture) {
        it.skip('skipped (no fixture corpus materialized)', () => {});
        return;
    }

    it('serves collection, section, and excerpt routes', async () => {
        const result = await runRouteSmoke(undefined, await getAvailablePort());
        expect(result.routeCount).toBeGreaterThan(0);
    }, 60_000);
});
