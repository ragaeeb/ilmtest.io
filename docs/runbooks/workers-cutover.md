# Workers Cutover

This runbook covers the `M4` code-runtime cutover after the `M3` runtime data plane is stable.

## Goal

Promote Cloudflare Workers to the only app runtime path while keeping corpus promotion separate from code deployment.

## Preconditions

- The intended dataset version is already published.
- `preview.json` or `prod.json` already points at the intended dataset.
- Local checks have passed:
- `bun run build`
- `bun run bundle-check`
- `bun run deploy-check`
- `bun run deploy-check:preview`
- `bun run smoke-routes`
- `bun run runtime-probe`

## Cost Model Check

Record the M4 cost assumptions before sign-off:

- every HTTP request still counts as one Worker invocation, even when the response is edge-cached
- browse cold path reads pointer + manifest + collections bootstrap artifact
- collection cold path adds one collection shard
- section cold path adds the bounded section chunk fan-out for that section, capped at `8`
- excerpt cold path currently includes the section load plus one target excerpt chunk read
- `robots.txt` performs no R2 reads
- `sitemap.xml` loads the browse baseline and then collection shards while enumerating section URLs

Preview traffic should remain maintainer-only and negligible. Production traffic is expected to be dominated by section and excerpt routes, so those route classes are the main R2 cost drivers to watch after cutover.

## Preview Validation

For the common manual path, prefer:

`bun run release-guided`

It records the full release session under `tmp/release-guided/<timestamp>/`, including per-step stdout/stderr logs, smoke and runtime-probe JSON outputs, and a `summary.json` file that is easy to hand to another agent for debugging.

1. Confirm preview channel state if needed:
   `bun scripts/validateDataset.ts remote --channel preview`
2. Deploy preview:
   `bun run deploy:preview`
3. Capture the preview Worker URL from Wrangler.
4. Validate the preview deployment:
   `bun run smoke-routes -- --base-url <preview-url>`
   `bun run runtime-probe -- --base-url <preview-url>`
5. Confirm:
   - preview `robots.txt` is non-indexable
   - preview `sitemap.xml` uses the preview origin
   - browse, collection, section, excerpt, and 404 routes are correct

## Production Cutover

1. Confirm production dataset state:
   `bun scripts/validateDataset.ts remote --channel prod`
2. Deploy production:
   `bun run deploy:prod`
3. Perform canary validation:
   `bun run smoke-routes -- --base-url https://ilmtest.io`
   `bun run runtime-probe -- --base-url https://ilmtest.io`
4. Verify runtime logs include the expected `datasetVersion` and `manifestKey`.
5. Confirm the route matrix is healthy:
   - browse, collection, section, excerpt, `robots.txt`, `sitemap.xml`, and `404` all pass
   - cache headers remain present on the SSR browse/read routes
   - the Worker deploy path is the only active production runtime path

## Rollback

If the issue is code/runtime:

1. Re-deploy the previous known-good commit with `bun run deploy:prod`.

If the issue is dataset selection:

1. Roll back the dataset pointer:
   `bun run rollback-dataset -- --channel prod --dataset-version <previous-version>`
2. Validate the channel:
   `bun scripts/validateDataset.ts remote --channel prod`

If both changed together, roll back the dataset pointer first, then re-deploy the known-good Worker commit.
