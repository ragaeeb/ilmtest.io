import { join } from 'node:path';
import { resolveDefaultRobotsPolicy, resolveRuntimeChannel } from '../src/lib/runtimeEnvironment';
import { startAstroDevServer } from './devServerHarness';
import { loadLocalRuntimeData, readChunkFromDisk } from './runtimeData';

const CACHE_HEADER = 'public, s-maxage=3600, stale-while-revalidate=86400';
const FETCH_TIMEOUT_MS = 10_000;

type HeaderExpectation = {
    name: string;
    value: string;
    match?: 'equals' | 'includes';
};

type SmokeRoute = {
    label: string;
    path: string;
    expectStatus?: number;
    expectText?: string;
    expectStrings?: string[];
    forbidStrings?: string[];
    expectHeaders?: HeaderExpectation[];
};

const getFlagValue = (args: string[], flag: string) => {
    const index = args.indexOf(flag);
    if (index === -1) {
        return undefined;
    }
    return args[index + 1];
};

const collectSmokeRoutes = async (baseUrl: string) => {
    const { collections, indexes, paths } = await loadLocalRuntimeData();
    const channel = resolveRuntimeChannel({ requestUrl: baseUrl });
    const origin = new URL(baseUrl).origin;
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
            expectHeaders: [{ name: 'Cache-Control', value: CACHE_HEADER }],
        },
        {
            label: 'robots',
            path: '/robots.txt',
            expectText: resolveDefaultRobotsPolicy(channel) === 'allow' ? 'Allow: /' : 'Disallow: /',
            expectStrings:
                resolveDefaultRobotsPolicy(channel) === 'allow'
                    ? [`Sitemap: ${new URL('/sitemap.xml', origin).toString()}`]
                    : undefined,
        },
        {
            label: 'sitemap',
            path: '/sitemap.xml',
            expectText: '<urlset',
            expectStrings: [new URL('/browse', origin).toString()],
            expectHeaders: [{ name: 'Cache-Control', value: CACHE_HEADER }],
        },
        {
            label: 'not-found',
            path: '/__smoke_missing_route__',
            expectStatus: 404,
        },
    ];

    for (const collection of collections) {
        const shardPath = join(paths.runtimeArtifactsDir, 'collections', `${collection.id}.json`);
        const hasShard = await Bun.file(shardPath).exists();
        if (!hasShard) {
            continue;
        }

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

        const excerptWords = excerpt.text?.split(/\s+/).filter(Boolean) ?? [];
        const excerptPreview = excerptWords.length > 0 ? excerptWords.slice(0, 8).join(' ') : (excerpt.nass ?? '');
        const excerptLabel = excerptWords.length > 8 ? `${excerptPreview}…` : excerptPreview;

        routes.push(
            {
                label: `${collection.slug}:collection`,
                path: `/browse/${collection.slug}`,
                expectText: collection.roman,
                expectStrings: [`/browse/${collection.slug}/${sectionId}`],
                forbidStrings: ['/undefined'],
                expectHeaders: [{ name: 'Cache-Control', value: CACHE_HEADER }],
            },
            {
                label: `${collection.slug}:section`,
                path: `/browse/${collection.slug}/${sectionId}`,
                expectText: heading.text,
                expectHeaders: [{ name: 'Cache-Control', value: CACHE_HEADER }],
            },
            {
                label: `${collection.slug}:excerpt`,
                path: `/browse/${collection.slug}/${sectionId}/e/${excerptId}`,
                expectText: excerptLabel,
                expectHeaders: [{ name: 'Cache-Control', value: CACHE_HEADER }],
            },
        );

        break;
    }

    return routes;
};

const assertSmokeRouteStatus = (route: SmokeRoute, response: Response) => {
    const expectedStatus = route.expectStatus ?? 200;
    if (response.status !== expectedStatus) {
        throw new Error(`${route.label} failed with ${response.status} at ${route.path}`);
    }
};

const assertSmokeRouteBody = (route: SmokeRoute, body: string) => {
    if (route.expectText && !body.includes(route.expectText)) {
        throw new Error(`${route.label} did not include expected text "${route.expectText}"`);
    }

    for (const expected of route.expectStrings ?? []) {
        if (!body.includes(expected)) {
            throw new Error(`${route.label} did not include expected string "${expected}"`);
        }
    }

    for (const forbidden of route.forbidStrings ?? []) {
        if (body.includes(forbidden)) {
            throw new Error(`${route.label} unexpectedly included "${forbidden}"`);
        }
    }
};

const assertSmokeRouteHeaders = (route: SmokeRoute, response: Response) => {
    for (const headerExpectation of route.expectHeaders ?? []) {
        const actualValue = response.headers.get(headerExpectation.name);
        if (!actualValue) {
            throw new Error(`${route.label} did not include header "${headerExpectation.name}"`);
        }

        if ((headerExpectation.match ?? 'equals') === 'includes') {
            if (!actualValue.includes(headerExpectation.value)) {
                throw new Error(
                    `${route.label} header "${headerExpectation.name}" did not include "${headerExpectation.value}"`,
                );
            }
            continue;
        }

        if (actualValue !== headerExpectation.value) {
            throw new Error(
                `${route.label} header "${headerExpectation.name}" was "${actualValue}" instead of "${headerExpectation.value}"`,
            );
        }
    }
};

const assertSmokeRoute = async (route: SmokeRoute, targetBaseUrl: string) => {
    const response = await fetch(new URL(route.path, targetBaseUrl), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    assertSmokeRouteStatus(route, response);

    const body = await response.text();
    assertSmokeRouteBody(route, body);
    assertSmokeRouteHeaders(route, response);
};

export const runRouteSmoke = async (baseUrl?: string, port = 4321) => {
    const server = baseUrl ? null : await startAstroDevServer(port);
    const targetBaseUrl = baseUrl ?? server?.baseUrl;

    if (!targetBaseUrl) {
        throw new Error('Failed to determine smoke test base URL');
    }

    const routes = await collectSmokeRoutes(targetBaseUrl);

    try {
        for (const route of routes) {
            await assertSmokeRoute(route, targetBaseUrl);
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
