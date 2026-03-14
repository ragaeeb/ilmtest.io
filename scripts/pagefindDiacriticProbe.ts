import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import * as pagefind from 'pagefind';
import { chromium } from 'playwright';

type TestRecord = {
    id: string;
    url: string;
    content: string;
    language: 'en' | 'ar';
};

type QueryResult = {
    query: string;
    urls: string[];
};

type ProbeResult = {
    pageLang: 'en' | 'ar';
    optionsApplied: boolean;
    optionsError: string | null;
    results: QueryResult[];
};

const records: TestRecord[] = [
    {
        id: 'en-plain-cafe',
        url: '/en/plain-cafe',
        content: 'A cafe with naive patrons who like resume tips.',
        language: 'en',
    },
    {
        id: 'en-diacritics-cafe',
        url: '/en/diacritics-cafe',
        content: 'A café with naïve patrons who like résumé tips.',
        language: 'en',
    },
    {
        id: 'en-long-vowels',
        url: '/en/long-vowels',
        content: 'Transliteration: ā ī ū',
        language: 'en',
    },
    {
        id: 'ar-plain-basmala',
        url: '/ar/plain-basmala',
        content: 'بسم الله الرحمن الرحيم',
        language: 'ar',
    },
    {
        id: 'ar-diacritics-basmala',
        url: '/ar/diacritics-basmala',
        content: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
        language: 'ar',
    },
    {
        id: 'ar-diacritics-hamd',
        url: '/ar/diacritics-hamd',
        content: 'الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ',
        language: 'ar',
    },
];

const englishQueries = ['cafe', 'café', 'naive', 'naïve', 'resume', 'résumé'];
const arabicQueries = ['بسم', 'بِسْم', 'الحمد', 'الْحَمْدُ'];

const englishExpected = new Map<string, string[]>([
    ['cafe', ['/en/plain-cafe', '/en/diacritics-cafe']],
    ['café', ['/en/plain-cafe', '/en/diacritics-cafe']],
    ['naive', ['/en/plain-cafe', '/en/diacritics-cafe']],
    ['naïve', ['/en/plain-cafe', '/en/diacritics-cafe']],
    ['resume', ['/en/plain-cafe', '/en/diacritics-cafe']],
    ['résumé', ['/en/plain-cafe', '/en/diacritics-cafe']],
]);

const arabicExpected = new Map<string, string[]>([
    ['بسم', ['/ar/plain-basmala', '/ar/diacritics-basmala']],
    ['بِسْم', ['/ar/plain-basmala', '/ar/diacritics-basmala']],
    ['الحمد', ['/ar/diacritics-hamd']],
    ['الْحَمْدُ', ['/ar/diacritics-hamd']],
]);

const CONTENT_TYPES: Record<string, string> = {
    html: 'text/html',
    js: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    pf_meta: 'application/json',
    wasm: 'application/wasm',
    svg: 'image/svg+xml',
};

const resolveContentType = (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    return ext ? CONTENT_TYPES[ext] : undefined;
};

const normalize = (values: string[]) => [...values].sort();

const expectSameMembers = (label: string, actual: string[], expected: string[]) => {
    assert.deepEqual(
        normalize(actual),
        normalize(expected),
        `${label}\nexpected: ${JSON.stringify(normalize(expected))}\nactual:   ${JSON.stringify(normalize(actual))}`,
    );
};

const createIndex = async (outputPath: string) => {
    const { index, errors } = await pagefind.createIndex();

    try {
        if (!index || (errors && errors.length > 0)) {
            throw new Error(`Pagefind index creation failed: ${errors?.join(', ') ?? 'unknown error'}`);
        }

        for (const record of records) {
            const { errors: addErrors } = await index.addCustomRecord({
                url: record.url,
                content: record.content,
                language: record.language,
            });

            if (addErrors && addErrors.length > 0) {
                throw new Error(`Failed to add record ${record.id}: ${addErrors.join(', ')}`);
            }
        }

        await mkdir(outputPath, { recursive: true });

        const { errors: writeErrors } = await index.writeFiles({ outputPath });
        if (writeErrors && writeErrors.length > 0) {
            throw new Error(`Failed to write pagefind index: ${writeErrors.join(', ')}`);
        }
    } finally {
        await pagefind.close();
    }
};

const serveStatic = (rootDir: string) => {
    const root = resolve(rootDir);
    return Bun.serve({
        port: 0,
        async fetch(request) {
            const url = new URL(request.url);
            const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'en.html';
            const filePath = resolve(root, relativePath);
            if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
                return new Response('Not found', { status: 404 });
            }
            const file = Bun.file(filePath);

            if (await file.exists()) {
                const contentType = resolveContentType(filePath);
                const headers = contentType ? new Headers({ 'Content-Type': contentType }) : undefined;
                return new Response(file, { headers });
            }

            return new Response('Not found', { status: 404 });
        },
    });
};

const writeProbeHtml = async (rootDir: string, lang: 'en' | 'ar') => {
    const html = `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <title>Pagefind ${lang.toUpperCase()} probe</title>
  </head>
  <body>
    <script type="module">
      import * as pagefind from '/pagefind/pagefind.js';
      window.__pagefind = pagefind;
    </script>
  </body>
</html>`;

    await writeFile(join(rootDir, `${lang}.html`), html, 'utf8');
};

const runQueries = async (baseUrl: string, pageLang: 'en' | 'ar', queryList: string[]): Promise<ProbeResult> => {
    const browser = await chromium.launch();

    try {
        const page = await browser.newPage();
        page.on('console', (message) => {
            console.log(`[browser:${message.type()}][${pageLang}] ${message.text()}`);
        });

        page.on('pageerror', (error) => {
            console.log(`[browser:error][${pageLang}] ${error.message}`);
        });

        await page.goto(`${baseUrl}/${pageLang}.html`, { waitUntil: 'load' });
        await page.waitForFunction(() => Boolean(window.__pagefind), undefined, { timeout: 30_000 });

        return await page.evaluate(
            // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: runs in browser context
            async ({ pageLang, queryList }) => {
                const instance = window.__pagefind;
                if (!instance) {
                    throw new Error('Pagefind not available in browser context');
                }

                let optionsApplied = false;
                let optionsError: string | null = null;

                if (typeof instance.options === 'function') {
                    try {
                        await instance.options({
                            baseUrl: '/',
                            exactDiacritics: false,
                            ranking: {
                                diacriticSimilarity: 0.0,
                            },
                        });
                        optionsApplied = true;
                    } catch (error) {
                        optionsError = error instanceof Error ? error.message : String(error);
                    }
                }

                if (typeof instance.init === 'function') {
                    await instance.init();
                }

                const results: QueryResult[] = [];

                for (const query of queryList) {
                    const search = await instance.search(query);
                    const urls: string[] = [];

                    for (const entry of search.results) {
                        const data = await entry.data();
                        urls.push(data.url);
                    }

                    results.push({ query, urls });
                }

                return {
                    pageLang,
                    optionsApplied,
                    optionsError,
                    results,
                };
            },
            { pageLang, queryList },
        );
    } finally {
        await browser.close();
    }
};

const assertExpectedMap = (probeName: string, actualResults: QueryResult[], expectedMap: Map<string, string[]>) => {
    for (const [query, expectedUrls] of expectedMap.entries()) {
        const found = actualResults.find((result) => result.query === query);
        assert.ok(found, `${probeName}: missing result entry for query "${query}"`);
        expectSameMembers(`${probeName}: query "${query}"`, found!.urls, expectedUrls);
    }
};

const main = async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'pagefind-diacritics-probe-'));
    const outputPath = join(tempRoot, 'pagefind');

    await createIndex(outputPath);
    await writeProbeHtml(tempRoot, 'en');
    await writeProbeHtml(tempRoot, 'ar');

    const server = serveStatic(tempRoot);

    try {
        const baseUrl = `http://localhost:${server.port}`;

        const englishProbe = await runQueries(baseUrl, 'en', englishQueries);
        const arabicProbe = await runQueries(baseUrl, 'ar', arabicQueries);

        console.log('--- English probe ---');
        console.log(JSON.stringify(englishProbe, null, 2));

        console.log('--- Arabic probe ---');
        console.log(JSON.stringify(arabicProbe, null, 2));

        assertExpectedMap('Arabic', arabicProbe.results, arabicExpected);

        try {
            assertExpectedMap('English', englishProbe.results, englishExpected);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
                [
                    message,
                    '',
                    'Latin accent folding is not active in this build.',
                    'If you are on Pagefind v1.4.x, that is expected.',
                    'Upgrade to pagefind@beta (v1.5.0-beta.1) or a later stable release that includes diacritics support, then rerun this probe.',
                ].join('\n'),
            );
        }

        console.log('All assertions passed.');
    } finally {
        server.stop(true);
    }
};

await main();

declare global {
    // eslint-disable-next-line no-var
    var __pagefind:
        | {
              init?: (options?: { baseUrl?: string; bundlePath?: string }) => Promise<void>;
              options?: (options: {
                  baseUrl?: string;
                  exactDiacritics?: boolean;
                  ranking?: {
                      diacriticSimilarity?: number;
                  };
              }) => Promise<void>;
              search: (query: string) => Promise<{
                  results: Array<{ id: string; data: () => Promise<{ url: string }> }>;
              }>;
          }
        | undefined;
}
