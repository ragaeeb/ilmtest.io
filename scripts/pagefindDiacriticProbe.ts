import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pagefind from 'pagefind';
import { chromium } from 'playwright';

type TestRecord = {
    id: string;
    url: string;
    content: string;
    language: 'en' | 'ar';
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

const queries = ['cafe', 'café', 'naive', 'naïve', 'resume', 'résumé', 'ā', 'بسم', 'بِسْم', 'الحمد', 'الْحَمْدُ'];

const createIndex = async (outputPath: string) => {
    const { index, errors } = await pagefind.createIndex({ forceLanguage: 'ar' });
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

    await pagefind.close();
};

const serveStatic = (rootDir: string) => {
    return Bun.serve({
        port: 0,
        async fetch(request) {
            const url = new URL(request.url);
            const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
            const filePath = join(rootDir, relativePath);
            const file = Bun.file(filePath);
            if (await file.exists()) {
                const ext = filePath.split('.').pop()?.toLowerCase();
                const contentType =
                    ext === 'html'
                        ? 'text/html'
                        : ext === 'js'
                          ? 'application/javascript'
                          : ext === 'css'
                            ? 'text/css'
                            : ext === 'json' || ext === 'pf_meta'
                              ? 'application/json'
                              : ext === 'wasm'
                                ? 'application/wasm'
                                : ext === 'svg'
                                  ? 'image/svg+xml'
                                  : undefined;
                const headers = contentType ? new Headers({ 'Content-Type': contentType }) : undefined;
                return new Response(file, { headers });
            }
            return new Response('Not found', { status: 404 });
        },
    });
};

const writeIndexHtml = async (rootDir: string) => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Pagefind Diacritic Probe</title>
  </head>
  <body>
    <script type="module">
      import * as pagefind from '/pagefind/pagefind.js';
      window.__pagefind = pagefind;
    </script>
  </body>
</html>`;
    await writeFile(join(rootDir, 'index.html'), html, 'utf8');
};

const runQueries = async (baseUrl: string) => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    try {
        page.on('console', (message) => {
            console.log(`[browser:${message.type()}] ${message.text()}`);
        });
        page.on('pageerror', (error) => {
            console.log(`[browser:error] ${error.message}`);
        });
        await page.goto(baseUrl, { waitUntil: 'load' });
        await page.waitForFunction(() => Boolean(window.__pagefind), undefined, { timeout: 30_000 });

        const results = await page.evaluate(async (queryList) => {
            const instance = window.__pagefind;
            if (!instance) {
                throw new Error('Pagefind not available in browser context');
            }
            if (typeof instance.init === 'function') {
                await instance.init({ baseUrl: '/pagefind/' });
            }

            const collected = [];
            for (const query of queryList) {
                const result = await instance.search(query);
                const urls = [];
                for (const entry of result.results) {
                    const data = await entry.data();
                    urls.push(data.url);
                }
                collected.push({ query, urls });
            }
            return collected;
        }, queries);

        for (const entry of results) {
            console.log(JSON.stringify(entry, null, 2));
        }
    } finally {
        await browser.close();
    }
};

const main = async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'ilmtest-pagefind-diacritics-'));
    const outputPath = join(tempRoot, 'pagefind');

    await createIndex(outputPath);
    await writeIndexHtml(tempRoot);

    const server = serveStatic(tempRoot);
    try {
        const baseUrl = `http://localhost:${server.port}`;
        await runQueries(baseUrl);
    } finally {
        server.stop(true);
    }
};

await main();

declare global {
    // eslint-disable-next-line no-var
    var __pagefind:
        | {
              init?: (options: { baseUrl?: string }) => Promise<void>;
              search: (query: string) => Promise<{
                  results: Array<{ id: string; data: () => Promise<{ url: string }> }>;
              }>;
          }
        | undefined;
}
