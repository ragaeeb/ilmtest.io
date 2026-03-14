import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startAstroDevServer } from './devServerHarness';

const FIXTURE_COLLECTION_SLUG = 'sample-shamela-text';
const FIXTURE_SECTION_ID = 'T0001';
const FIXTURE_EXCERPT_ID = 'T0001-E001';

const runCommand = async (command: string[], cwd = process.cwd()) => {
    const proc = Bun.spawn(command, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : '',
        proc.stderr ? new Response(proc.stderr).text() : '',
        proc.exited,
    ]);
    if (exitCode !== 0) {
        throw new Error(`Command failed: ${command.join(' ')}\n${stderr || stdout}`);
    }
};

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

const ensureFixtureData = async () => {
    const hasCollections = await Bun.file(join('src', 'data', 'collections.json')).exists();
    const shouldGenerate = process.env.E2E_USE_FIXTURE === '1' || !hasCollections;
    if (!shouldGenerate) {
        return;
    }

    await runCommand(['bun', 'scripts/setupFixture.ts', 'tiny']);
};

const ensureSearchIndex = async () => {
    const pagefindPath = join('public', 'pagefind', 'pagefind.js');
    const hasPagefind = await Bun.file(pagefindPath).exists();
    const forceBuild = process.env.E2E_USE_FIXTURE === '1';
    if (hasPagefind && !forceBuild) {
        return;
    }

    await runCommand(['bun', 'scripts/buildSearchIndex.ts', '--output', 'public/pagefind']);
};

const runE2E = async () => {
    const startedAt = Date.now();
    await ensureFixtureData();
    await ensureSearchIndex();

    const port = await getAvailablePort();
    const server = await startAstroDevServer(port);
    const browser = await chromium.launch({ headless: process.env.E2E_HEADLESS === '1' });
    const page = await browser.newPage();

    try {
        await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
        await page.locator('header').getByRole('link', { name: 'Browse', exact: true }).waitFor();

        await page.goto(`${server.baseUrl}/browse`, { waitUntil: 'networkidle' });
        await page.locator('main').getByRole('heading', { name: 'Sample Shamela Text', exact: true }).first().waitFor();
        await page.locator('main').getByRole('heading', { name: 'Sample Web Articles', exact: true }).first().waitFor();

        await page.goto(`${server.baseUrl}/browse/${FIXTURE_COLLECTION_SLUG}`, { waitUntil: 'networkidle' });
        await page.getByRole('heading', { name: 'Sample Shamela Text', exact: true }).waitFor();

        await page.goto(`${server.baseUrl}/browse/${FIXTURE_COLLECTION_SLUG}/${FIXTURE_SECTION_ID}`, {
            waitUntil: 'networkidle',
        });
        await page.getByRole('heading', { name: 'Tier 1 Section 1 of Sample Shamela Text', exact: true }).waitFor();

        await page.goto(
            `${server.baseUrl}/browse/${FIXTURE_COLLECTION_SLUG}/${FIXTURE_SECTION_ID}/e/${FIXTURE_EXCERPT_ID}`,
            { waitUntil: 'networkidle' },
        );
        await page.getByText('Excerpt 1 from section 1 of Sample Shamela Text', { exact: false }).waitFor();

        await page.goto(`${server.baseUrl}/search`, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: 'Search (⌘K)' }).click();
        const searchInput = page.getByPlaceholder('Search excerpts…');
        await searchInput.waitFor();
        await page.waitForTimeout(1500);
        await searchInput.fill('');
        await searchInput.fill('Excerpt 1');
        await page.waitForTimeout(300);

        const emptyState = page.getByText('Search the collection', { exact: false });
        if (await emptyState.isVisible()) {
            await searchInput.press('Space');
            await searchInput.press('Backspace');
        }
        await page.waitForTimeout(800);

        const resultLink = page.locator(
            `a[href*="/browse/${FIXTURE_COLLECTION_SLUG}/${FIXTURE_SECTION_ID}/e/${FIXTURE_EXCERPT_ID}"]`,
        );
        const noResults = page.getByText('No results found', { exact: false });
        const unavailable = page.getByText('Search unavailable', { exact: false });

        await Promise.race([
            resultLink.first().waitFor({ timeout: 15_000 }),
            noResults.waitFor({ timeout: 15_000 }),
            unavailable.waitFor({ timeout: 15_000 }),
        ]);

        if (await unavailable.isVisible()) {
            throw new Error('Search unavailable in E2E run');
        }

        if (await noResults.isVisible()) {
            throw new Error('Search returned no results in E2E run');
        }

        const elapsedMs = Date.now() - startedAt;
        console.log(
            JSON.stringify(
                {
                    status: 'ok',
                    baseUrl: server.baseUrl,
                    fixture: 'tiny',
                    checks: [
                        '/',
                        '/browse',
                        `/browse/${FIXTURE_COLLECTION_SLUG}`,
                        `/browse/${FIXTURE_COLLECTION_SLUG}/${FIXTURE_SECTION_ID}`,
                        `/browse/${FIXTURE_COLLECTION_SLUG}/${FIXTURE_SECTION_ID}/e/${FIXTURE_EXCERPT_ID}`,
                        '/search',
                    ],
                    durationMs: elapsedMs,
                },
                null,
                2,
            ),
        );
    } finally {
        await browser.close();
        await server.dispose();
    }
};

await runE2E();
