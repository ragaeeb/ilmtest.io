# QA and Observability Baseline

This is the `M2` QA floor before the runtime data-plane refactor and Workers cutover land.

## CI Lanes

- Contributor lane: tiny fixture, no secrets, runs lint, check, unit tests, integrity checks, build, and route smoke tests.
- Maintainer lane: medium fixture, manual trigger, runs the same checks plus a baseline snapshot artifact.
- Release lane: full corpus, manual trigger, intended for protected validation with real source credentials.

## Required Integrity Checks

- every collection route has a slug
- every section route has chunk mappings
- the first section chunk contains the heading marker
- every excerpt resolves through `excerptToChunk`
- every chunk referenced by indexes exists on disk
- no local chunk file is orphaned
- local dataset metadata validates through `validate-dataset`
- curated metadata files do not reference unknown `collectionId`, `sectionId`, `excerptId`, `entityId`, or `authorId`

## Route Smoke Coverage

The smoke suite fetches:

- `/`
- `/browse`
- one collection route per collection in the current local corpus
- one section route per collection
- one excerpt route per collection

## Runtime Signals To Preserve Into M3/M4

Minimum log fields:

- `datasetVersion`
- `manifestKey`
- `collectionId`
- `routeType`
- `cacheStatus`
- `chunkKey`
- `r2Operation`
- `durationMs`

Current implementation notes:

- runtime loaders emit structured log lines with a `[runtime]` prefix from [`src/lib/data.ts`](/Users/rhaq/workspace/ilmtest.io/src/lib/data.ts) and [`src/lib/excerptChunks.ts`](/Users/rhaq/workspace/ilmtest.io/src/lib/excerptChunks.ts)
- missing runtime artifacts return a controlled `503` route response instead of a silent fallback
- `bun run runtime-probe` measures cold/warm section timings, verifies excerpt citation rendering, and checks the local missing-shard error path
- `bun run runtime-probe -- --base-url <preview-url>` targets a deployed preview for maintainer validation

Minimum operational counters:

- edge cache hit/miss trend by route type
- R2 `get/head/list/put/delete` counts and error rates
- publish/promote/rollback audit events
- D1 query and error placeholders for later report milestones
- WAF challenge/allow/block counters
- Turnstile pass/fail counters for future write paths

## Local QA Commands

- `bun run setup-fixture -- tiny`
- `bun run validate-dataset`
- `bun run integrity`
- `bun run build`
- `bun run bundle-check`
- `bun run smoke-routes`
- `bun run runtime-probe`
