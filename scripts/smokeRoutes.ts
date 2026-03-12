import { join } from 'node:path';
import { loadLocalRuntimeData, readChunkFromDisk } from './runtimeData';

type SmokeRoute = {
    label: string;
    path: string;
    expectText: string;
};

const getFlagValue = (args: string[], flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) {
        return undefined;
    }
    return args[index + 1];
};

const readSubprocessPipe = async (pipe: Bun.Subprocess['stdout']) => {
    if (!pipe || typeof pipe === 'number') {
        return '';
    }

    return new Response(pipe).text();
};

const waitForServer = async (baseUrl: string, server: Bun.Subprocess, timeoutMs = 30_000) => {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (server.exitCode !== null) {
            const [stdout, stderr] = await Promise.all([
                readSubprocessPipe(server.stdout),
                readSubprocessPipe(server.stderr),
            ]);
            throw new Error(`Dev server exited early.\nstdout:\n${stdout}\n\nstderr:\n${stderr}`);
        }

        try {
            const response = await fetch(new URL('/', baseUrl));
            if (response.ok) {
                return;
            }
        } catch {
            // Server is still starting.
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    server.kill();
    throw new Error(`Timed out waiting for dev server at ${baseUrl}`);
};

const startDevServer = async (port: number) => {
    const astroBin = join(process.cwd(), 'node_modules', '.bin', 'astro');
    const server = Bun.spawn(['node', astroBin, 'dev', '--host', '127.0.0.1', '--port', String(port)], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl, server);

    return {
        baseUrl,
        dispose: async () => {
            server.kill();
            await server.exited;
        },
    };
};

const collectSmokeRoutes = async () => {
    const { collections, indexes, paths } = await loadLocalRuntimeData();
    const routes: SmokeRoute[] = [
        {
            label: 'homepage',
            path: '/',
            expectText: 'IlmTest',
        },
        {
            label: 'browse',
            path: '/browse',
            expectText: collections[0]?.roman ?? 'Browse Collections',
        },
    ];

    for (const collection of collections) {
        const sectionId = indexes.collectionToSections[collection.id]?.[0];
        if (!sectionId) {
            continue;
        }

        const sectionChunkId = indexes.sectionToChunks[collection.id]?.[sectionId]?.[0];
        const excerptId = indexes.sectionToExcerpts[collection.id]?.[sectionId]?.[0];
        if (!sectionChunkId || !excerptId) {
            continue;
        }

        const [sectionChunk, excerptChunk] = await Promise.all([
            readChunkFromDisk(paths.chunksDir, sectionChunkId),
            readChunkFromDisk(paths.chunksDir, indexes.excerptToChunk[collection.id][excerptId]),
        ]);
        const heading = sectionChunk.excerpts.find((excerpt) => excerpt.id === sectionId);
        const excerpt = excerptChunk.excerpts.find((candidate) => candidate.id === excerptId);
        if (!heading || !excerpt) {
            continue;
        }

        routes.push(
            {
                label: `${collection.slug}:collection`,
                path: `/browse/${collection.slug}`,
                expectText: collection.roman,
            },
            {
                label: `${collection.slug}:section`,
                path: `/browse/${collection.slug}/${sectionId}`,
                expectText: heading.text,
            },
            {
                label: `${collection.slug}:excerpt`,
                path: `/browse/${collection.slug}/${sectionId}/e/${excerptId}`,
                expectText: excerpt.text.split('\n')[0],
            },
        );
    }

    return routes;
};

export const runRouteSmoke = async (baseUrl?: string, port = 4321) => {
    const routes = await collectSmokeRoutes();
    const server = baseUrl ? null : await startDevServer(port);
    const targetBaseUrl = baseUrl ?? server?.baseUrl;

    if (!targetBaseUrl) {
        throw new Error('Failed to determine smoke test base URL');
    }

    try {
        for (const route of routes) {
            const response = await fetch(new URL(route.path, targetBaseUrl));
            if (!response.ok) {
                throw new Error(`${route.label} failed with ${response.status} at ${route.path}`);
            }

            const body = await response.text();
            if (!body.includes(route.expectText)) {
                throw new Error(`${route.label} did not include expected text "${route.expectText}"`);
            }
        }
    } finally {
        await server?.dispose();
    }

    return {
        baseUrl: targetBaseUrl,
        routeCount: routes.length,
    };
};

const main = async () => {
    const args = process.argv.slice(2);
    const result = await runRouteSmoke(
        getFlagValue(args, '--base-url'),
        getFlagValue(args, '--port') ? Number(getFlagValue(args, '--port')) : 4321,
    );
    console.log(JSON.stringify(result, null, 2));
};

if (import.meta.main) {
    await main();
}
