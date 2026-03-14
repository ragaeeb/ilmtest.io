# Deploying IlmTest to Cloudflare Workers

This guide documents the canonical `M4` deploy path. Cloudflare Workers is now the only supported runtime path for the app. Corpus publishing remains a separate lane documented in:

- [Publish Corpus](docs/runbooks/publish-corpus.md)
- [Roll Back Corpus](docs/runbooks/rollback-corpus.md)
- [Workers Cutover](docs/runbooks/workers-cutover.md)
- [QA And Observability Baseline](docs/qa.md)

## Prerequisites

1. Cloudflare account with Workers, R2, and the target domain configured.
2. Bun `>=1.3.10`.
3. Node `>=25.0.0`.
4. Wrangler `^4.72.0` from `devDependencies`.

## First-Time Cloudflare Bootstrap

For the common manual path, prefer:

`bun run cloudflare-guided`

This interactive flow:

- verifies Wrangler authentication
- defaults the dataset bucket name to `ilmtest-datasets`
- can create or verify the R2 bucket
- writes `R2_BUCKET`, `CF_ACCOUNT_ID`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` into `.env`
- updates `wrangler.jsonc` so the `EXCERPT_BUCKET` binding points at the same bucket

Each run writes a timestamped debug bundle under `tmp/cloudflare-guided/` with command stdout, stderr, a structured summary, and any captured errors.

## Build Output

- Build command: `bun run build`
- Static asset output: `dist/client`
- Worker bundle output: `dist/functions/index.mjs`
- Generated Wrangler config: `dist/functions/wrangler.json`
- Search index output: `dist/client/pagefind`

## Runtime Environments

The runtime environment is explicit:

- Production deploys use the default Wrangler environment and set `ILMTEST_RUNTIME_CHANNEL=prod`.
- Preview deploys use `wrangler --env preview` and set `ILMTEST_RUNTIME_CHANNEL=preview`.
- Preview also defaults `PUBLIC_ROBOTS_POLICY=disallow` and `PUBLIC_AI_CRAWL_POLICY=disallow`.
- `ILMTEST_DATASET_VERSION_OVERRIDE` is optional and is only honored in preview or local/dev contexts.

Both environments require the `EXCERPT_BUCKET` R2 binding.
The repo default bucket name is `ilmtest-datasets`. If you override it, keep `.env` and `wrangler.jsonc` aligned.

## Canonical Commands

- `bun run cloudflare-guided`
- `bun run deploy:prod`
- `bun run deploy:preview`
- `bun run deploy-check`
- `bun run deploy-check:preview`
- `bun run release-guided`

`deploy-check` and `deploy-check:preview` generate target-specific Wrangler configs under `dist/functions/` and then run `wrangler deploy --dry-run` against the built Worker bundle and asset directory.

For the common manual release path, prefer:

`bun run release-guided`

This interactive flow validates the chosen dataset version, promotes `preview` if needed, runs local build and deploy checks, deploys preview, runs smoke and runtime-probe checks against the deployed preview URL, and can then promote and deploy production. Each run writes a timestamped report bundle under `tmp/release-guided/` with per-step stdout, stderr, structured JSON summaries, and any captured errors.

## Local Validation Flow

1. Materialize the intended corpus:
   `bun run setup-fixture -- tiny`
   or
   `bun run setup <collection ids...>`
2. Build the Worker bundle:
   `bun run build`
3. Validate the deploy contract:
   `bun run deploy-check`
4. Validate route behavior locally:
   `bun run smoke-routes`
   `bun run runtime-probe`

## Preview Deployment Flow

1. Promote or validate the preview dataset pointer if needed:
   `bun run promote-dataset -- --channel preview --dataset-version <dataset-version>`
2. Deploy the Worker preview:
   `bun run deploy:preview`
3. Capture the preview URL returned by Wrangler.
4. Run preview validation against that URL:
   `bun run smoke-routes -- --base-url <preview-url>`
   `bun run runtime-probe -- --base-url <preview-url>`
5. Confirm:
   - `robots.txt` disallows indexing
   - `sitemap.xml` uses the preview origin, not `https://ilmtest.io`
   - browse, collection, section, excerpt, and 404 routes behave correctly

## Production Deployment Flow

1. Confirm the production channel points at the intended dataset:
   `bun scripts/validateDataset.ts remote --channel prod`
2. Deploy the Worker:
   `bun run deploy:prod`
3. Validate the production routes:
   `bun run smoke-routes -- --base-url https://ilmtest.io`
   `bun run runtime-probe -- --base-url https://ilmtest.io`

## Cloudflare Configuration Notes

- `wrangler.jsonc` defines the runtime channel mapping and preview robots posture.
- The Astro build generates the deployable Worker config at `dist/functions/wrangler.json`.
- `scripts/prepareWorkerDeploy.ts` materializes `dist/functions/wrangler.prod.json` or `dist/functions/wrangler.preview.json` from that generated bundle config plus `wrangler.jsonc`.
- The Worker serves static assets through the generated `ASSETS` binding from `dist/client`.
- Keep the `EXCERPT_BUCKET` binding present in both default and `preview` environments.

## Cache Rules

Browse and excerpt routes still rely on application-set cache headers:

- `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`
- `CDN-Cache-Control: max-age=3600`

Keep the Cloudflare cache rule for `/browse/*` and respect origin headers.

## M4 Cost Model

M4 requires the runtime cost model to be explicit before sign-off.

### Worker invocation rule

Every request still incurs one Worker invocation, even when the HTML response is edge-cached. The cache policy reduces origin recomputation and R2 activity, but it does not reduce Worker request count.

### Cold-path R2 Class B read assumptions

These are the expected remote reads on a cold request when the in-process runtime cache is empty:

- Browse index: `prod.json` or `preview.json` pointer, dataset manifest, collections bootstrap artifact.
- Collection page: browse baseline plus one collection shard.
- Section page: collection baseline plus `N` excerpt chunk reads for that section.
- Excerpt page: current implementation uses the section loader first, so it matches the section baseline plus one additional target chunk read.
- `robots.txt`: no R2 reads.
- `sitemap.xml`: browse baseline plus one collection shard per collection while enumerating section URLs.

Section fan-out is intentionally bounded. The runtime rejects a section with more than `8` chunk descriptors, so the worst-case cold-path section read shape is known and treated as an ETL bug if exceeded.

### Warm-path assumptions

When the Worker runtime cache is warm:

- pointer, manifest, collections bootstrap, and collection shards are served from memory until their TTL expires
- section routes still read the excerpt chunks required for that section
- excerpt routes still read the target excerpt chunk after the section data is loaded

This means warm traffic primarily shifts cost from metadata/object-discovery reads to the chunk reads required by the requested reading route.

### Traffic-mix assumptions

Use this simple planning model for sign-off:

- Production: mostly human browse traffic, with section and excerpt routes dominating read volume.
- Preview: maintainer-only validation traffic, short-lived, low volume, and expected to be negligible relative to production.
- Production mix assumption for reasoning: browse and collection routes are a minority of requests; section and excerpt routes dominate both Worker invocations and R2 reads.

This model is sufficient for M4 because the goal is to validate that the route classes are bounded and observable, not to build a full forecasting spreadsheet.

### Sign-off checks

Before treating the cutover as complete, confirm:

- `bun run deploy-check`
- `bun run deploy-check:preview`
- `bun run smoke-routes`
- `bun run runtime-probe`
- preview validation against the deployed preview URL
- production canary validation against `https://ilmtest.io`

The smoke and probe flow covers browse, collection, section, excerpt, `robots.txt`, `sitemap.xml`, and `404` behavior, plus the cache headers expected by the SSR reading routes.

## Troubleshooting

- Preview `robots.txt` allows indexing:
  - Confirm the deploy used `bun run deploy:preview`.
  - Confirm `ILMTEST_RUNTIME_CHANNEL=preview` is present in the preview environment.
- Preview `sitemap.xml` points at `https://ilmtest.io`:
  - Confirm the route is using the deployed preview URL and not a production alias.
  - Re-run `bun run smoke-routes -- --base-url <preview-url>`.
- Worker deploy fails after a successful build:
  - Run `bun run deploy-check` locally to isolate asset/binding configuration errors.
- Browse pages show missing data:
  - Confirm the deployed environment has the `EXCERPT_BUCKET` binding.
  - Confirm the channel pointer (`prod.json` or `preview.json`) references a valid manifest.
