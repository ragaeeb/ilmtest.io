# IlmTest Revised Implementation Plan

## Status

This document supersedes the earlier proposal as the implementation source of truth.

It is based on:

- the current repo state
- the original research synthesis
- the proposal review documents in `docs/proposal-reviews/`
- an independent source check against current Astro, Cloudflare, and Pagefind docs

This plan is intentionally specific. The developer implementing it should not need to infer architecture direction, milestone order, or fallback strategy.

## Final Decisions

These decisions are locked unless a later ADR explicitly changes them:

1. **Cloudflare Workers is the target runtime.** Pages is legacy/current-state context only.
2. **The data plane is the first priority.** Fix publish and runtime metadata before feature work.
3. **Corpus publishing, code deploy, and dataset promotion are separate release lanes.**
4. **The corpus is published under immutable dataset prefixes in R2.**
5. **The active dataset is selected by a small pointer object plus a manifest in R2.**
6. **Canonical runtime artifacts live in R2, not KV.** KV is deferred because eventual consistency works against dataset-version coherence.
7. **Search starts with Pagefind via custom records.** Do not pivot to server-side search unless Pagefind fails measured budgets.
8. **Reports use D1.** Accepted corrections do not use runtime overlays; they become source-backed data updates followed by regeneration and republish.
9. **Inline mentions are deferred.** They are not on the main implementation path.
10. **No Pages fallback is planned.** The rollback mechanism is at the code commit and dataset version level, not a parallel runtime.
11. **One top-level runtime manifest pins the compatible artifact set.** Even if search, relations, or taxonomy artifacts are built in separate lanes, runtime resolution must still go through one compatible manifest-selected set.

## Why These Decisions Changed

The review pass was useful, but several review claims were either outdated or too broad for this repo:

- Pagefind now officially documents Arabic stemming support, so the question is measured relevance, not basic support.
- Cloudflare R2 now documents strong consistency for list operations, which makes manifest/pointer promotion viable.
- Workers static-asset file limits are not the limiting factor for excerpt chunks because the chunks already live in R2.
- KV is still eventually consistent, which makes it the wrong place for canonical dataset pointers or canonical lookup shards.
- D1 is an acceptable operational store for a moderated report queue at this scale.

## Current Repo Reality

These facts should anchor implementation:

- [`package.json`](/Users/rhaq/workspace/ilmtest.io/package.json) still couples build, chunk upload, and Pages deploy in one command.
- [`scripts/uploadR2.ts`](/Users/rhaq/workspace/ilmtest.io/scripts/uploadR2.ts) still uploads by spawning `wrangler r2 object put` per object and still contains hardcoded local debug telemetry.
- [`src/lib/data.ts`](/Users/rhaq/workspace/ilmtest.io/src/lib/data.ts) eagerly imports local `src/data/*.json` into the server bundle.
- [`src/lib/excerptChunks.ts`](/Users/rhaq/workspace/ilmtest.io/src/lib/excerptChunks.ts) already fetches chunk objects from the `EXCERPT_BUCKET` R2 binding using `cloudflare:workers`.
- [`astro.config.mjs`](/Users/rhaq/workspace/ilmtest.io/astro.config.mjs) uses Astro's Cloudflare adapter while keeping `output: 'static'` and opting specific routes into SSR.
- [`wrangler.jsonc`](/Users/rhaq/workspace/ilmtest.io/wrangler.jsonc) already defines the R2 binding and compatibility date, but the deploy script still targets Pages.

## Delivery Order

The delivery order is:

| Milestone | Theme | Risk | Ship Gate |
| --- | --- | --- | --- |
| M0 | Baseline, ADRs, source continuity | Medium | Required before architecture changes |
| M1 | Dataset publishing and promotion | High | Required before runtime refactor |
| M2 | Fixture CI, integrity, observability, security baseline | Medium | Required before risky refactors land |
| M3 | Runtime data-plane refactor | High | Required before Workers cutover |
| M4 | Workers cutover | High | Preview and canary must pass |
| M5 | Search MVP | Medium | Must meet payload and relevance budgets |
| M6 | Relations v1 | Medium | Must stay sparse and bounded |
| M7 | Taxonomy foundation | Low-Medium | Must remain curated and precomputed |
| M8 | Reports and source-backed corrections | Medium | Must be abuse-resistant and reproducible |
| M9 | Discoverability and Arabic hardening gates | Low-Medium | Required before public launch |
| Deferred | Inline mentions | High | Not in current delivery path |

## Risk Profile

### Highest-risk work

- M1 dataset publishing and promotion
- M3 runtime data-plane refactor
- M4 Workers cutover
- M5 search indexing at corpus scale

These areas need the heaviest test coverage, explicit rollback paths, and preview validation.

### Lower-risk work

- M7 taxonomy
- most of M9 SEO/discoverability work
- documentation, runbooks, and contributor workflow

These still need tests, but they are less likely to destabilize the request path.

## Development Methodology

Follow this methodology for every milestone:

### 1. TDD for pure logic

Use test-first or contract-first development for:

- manifest generation and validation
- dataset pointer resolution
- schema validators
- lookup sharding logic
- search record generation
- report deduplication logic
- relation and taxonomy read-model generation

### 2. Golden tests for rendered output

For route output and search relevance, use golden or snapshot-style fixtures:

- known fixture URLs
- known search queries
- known entity/tag/report examples

These should be intentionally small and readable.

### 3. Contract tests between ETL output and runtime loaders

Every generated artifact must have:

- a schema
- a validator
- a runtime loader test
- a failure mode that is explicit, not silent

### 4. Fixture-first implementation

Do not develop new behavior only against the full corpus.

Use:

- tiny fixture for PRs and local fast iteration
- medium fixture for maintainer validation
- full corpus only for release, scale, and performance checks

### 5. One milestone branch/PR at a time

Do not combine M1, M3, and M5-style changes into a single large branch.

Each milestone must end with:

- code
- tests
- runbook updates
- a short "what changed / how to roll back" note

### 6. No silent fallbacks

If a dataset pointer, manifest, lookup shard, or report table is wrong:

- fail loudly
- log the dataset version and artifact key
- return a controlled error path

Do not silently serve a stale or guessed artifact.

## Cross-Cutting Technical Rules

These rules apply to all milestones:

1. Arabic reading routes stay low-JS.
2. Excerpt and section pages remain SSR with explicit cache headers.
3. Corpus-derived runtime data is never treated as "just build output" again.
4. Canonical source-of-truth artifacts must be strongly consistent.
5. Preview and production must be able to point at different dataset versions without code changes.
6. Every data artifact format must carry an explicit schema version.
7. Every milestone must document where logs and metrics will show failures.

## Target File/Directory Additions

These are the expected new paths unless a later implementation note explains a better equivalent:

- `docs/adr/`
- `docs/runbooks/publish-corpus.md`
- `docs/runbooks/rollback-corpus.md`
- `docs/runbooks/workers-cutover.md`
- `docs/fixtures.md`
- `docs/qa.md`
- `docs/security-baseline.md`
- `scripts/reportBaseline.ts`
- `scripts/publishDataset.ts`
- `scripts/buildSearchIndex.ts`
- `scripts/validateDataset.ts`
- `src/lib/datasetPointer.ts`
- `src/lib/datasetManifest.ts`
- `src/lib/runtimeArtifacts.ts`
- `src/lib/runtimeCache.ts`
- `src/data-curated/entities/`
- `src/data-curated/relations/`
- `src/data-curated/taxonomy/`
- `src/data-curated/corrections/`
- `test/fixtures/tiny/`
- `test/fixtures/medium/`

The exact filenames can vary, but the concepts above must exist.

## M0: Baseline, ADRs, and Source Continuity

### Goal

Capture the current state before changing the architecture and lock the key decisions in writing.

### Scope

- Baseline measurement script
- ADR set
- source-data continuity plan
- schema-versioning envelope

### Implementation Details

1. Add a baseline script, likely `scripts/reportBaseline.ts`, that reports:
   - current chunk count
   - total chunk bytes
   - current `src/data` bytes
   - current build output bytes
   - current server bundle bytes
   - top section fan-out counts
   - rough R2 read fan-out by route type
2. Capture the current deploy coupling explicitly:
   - current `deploy` script behavior
   - current Pages dependency
   - current R2 upload behavior
3. Create ADRs for:
   - Workers target runtime
   - immutable dataset publishing
   - R2 manifest/pointer as the canonical dataset selector
   - Pagefind as search MVP
   - D1 for reports and source-backed corrections
   - inline mentions deferred
4. Add source continuity notes:
   - pin Hugging Face dataset revision during ETL
   - pin `@ilmtest/ilmtest-sdk-js` version
   - define where raw-source snapshots or cached inputs are stored during release builds
5. Add a support matrix note:
   - supported Bun version
   - supported Node version
   - supported Wrangler version policy
   - required env vars by workflow
   - local vs CI vs cloud responsibilities
6. Define schema-version fields:
   - `datasetSchemaVersion`
   - `chunkSchemaVersion`
   - `artifactSchemaVersion`
   - `appMinDatasetSchemaVersion`

### Tests

- Unit test for the baseline script output shape
- Validate that the script runs on fixture data without credentials
- Validate that ADR links resolve

### Smoke Tests

- `bun run check`
- `bun run lint`
- baseline report generation succeeds

### Exit Criteria

- Baseline metrics are committed
- ADRs exist and are linked from architecture docs
- source continuity rules are documented

### If Bugs Appear, Look Here

- `scripts/setup.ts`
- `scripts/reportBaseline.ts`
- `src/lib/data.ts`
- `package.json`
- `docs/architecture.md`

## M1: Dataset Publishing and Promotion

### Goal

Replace in-place, per-object, live-bucket updates with a versioned, verifiable dataset publish flow.

### Why This Is First

This is the current operational bottleneck and the prerequisite for safe runtime migration.

### Scope

- immutable dataset prefixes
- manifest generation
- pointer-based promotion
- primary publisher replacement
- retention policy
- rollback runbook

### Implementation Details

#### Dataset layout

Publish each dataset under a unique immutable prefix:

`datasets/<datasetVersion>/`

At minimum, each dataset contains:

- `manifest.json`
- `chunks/**`
- `artifacts/bootstrap/**`
- `artifacts/collections/**`

Later milestones may add:

- `artifacts/search/**`
- `artifacts/relations/**`
- `artifacts/taxonomy/**`

#### Dataset version format

Use a timestamp-based immutable ID with a short git suffix, for example:

`2026-03-12T18-42-10Z-abc1234`

Do not use mutable names like `latest`.

#### Channel strategy

Start with only:

- `channels/prod.json`
- `channels/preview.json`

Do not add `staging` until there is a real shared staging environment.

Each pointer object should contain:

- `datasetVersion`
- `manifestKey`
- `publishedAt`
- optional `notes`

#### Manifest schema

The manifest must include:

- schema versions
- dataset version
- creation timestamp
- source provenance
- SDK/tool versions
- git commit
- artifact counts
- artifact bytes
- artifact hashes
- compatibility range for the app/runtime
- the exact compatible artifact set exposed to runtime code

Do not ship a minimal count-only manifest. The manifest is the dataset contract.

#### Publisher implementation

Replace `scripts/uploadR2.ts` with a single-process TypeScript publisher.

Default implementation choice:

- use the R2 S3-compatible API
- prefer `@aws-sdk/client-s3` plus multipart helpers because Cloudflare documents this path directly

Accept Bun's S3 client only if a short spike proves it can satisfy the same acceptance tests cleanly.

The publisher must support:

- bounded concurrency
- resumable uploads
- local hash generation
- remote existence checks
- sampled HEAD/GET verification
- manifest upload
- pointer promotion
- rollback command

Remove the hardcoded local telemetry endpoint while doing this work.

#### Retention policy

Start with:

- retain the last `3` promoted production datasets
- retain the latest `1` preview dataset
- delete older preview datasets after the next successful preview publish

Keep the policy explicit in the runbook.

#### Operator fallback

Document `rclone sync` as the emergency fallback.

Do not make `rclone` the canonical publish path. Bulk sync is not enough; the repo needs a publish control plane with manifest and promotion semantics.

### Tests

- Unit tests for manifest validation
- Unit tests for pointer validation
- Integration test: publish to a non-prod prefix
- Integration test: interrupted upload resume
- Integration test: promote dataset A, promote dataset B, roll back to A
- Verification test: local counts and hashes match the manifest

### Smoke Tests

- fetch the new `manifest.json` from R2
- fetch a sample chunk from the new prefix
- resolve `prod.json` and `preview.json`
- preview app can read the newly promoted preview dataset

### Exit Criteria

- failed publishes can resume safely
- no partial-live state exists between upload and promotion
- rollback works without re-uploading the old dataset
- publish time is materially better than the current Wrangler loop

### Risk Level

High

### If Bugs Appear, Look Here

- key naming and path normalization in the publisher
- manifest generation and hash code
- pointer contents
- list pagination and resume logic
- `wrangler.jsonc` bucket binding names
- lingering telemetry or old `uploadR2.ts` call sites

## M2: Fixture CI, Integrity, Observability, and Security Baseline

### Goal

Make risky changes testable before M3 and M4 land.

### Scope

- tiny and medium fixtures
- PR-safe CI
- schema/integrity checks
- observability baseline
- Cloudflare-first security baseline

### Implementation Details

#### Fixtures

Create:

- tiny fixture: fast enough for every PR
- medium fixture: one Shamela-like sample plus one web-scraped sample with around `100` sections each

The fixtures must preserve the hard parts:

- hierarchical headings
- bilingual excerpt content
- citations
- chunk boundaries
- route generation

#### CI lanes

Create three lanes:

1. contributor lane
   - tiny fixture
   - no secrets
   - build, route smoke tests, schema checks
2. maintainer lane
   - medium fixture
   - optional secrets if needed
   - stronger smoke and performance checks
3. release lane
   - full corpus
   - protected/manual or branch-limited

#### Integrity checks

Validate:

- every generated route resolves
- every excerpt ID resolves to a chunk
- every chunk referenced by an index exists
- every generated artifact matches its schema
- no orphan references in curated metadata

#### Observability baseline

Before the Workers cutover, define:

- log fields for `datasetVersion`, `manifestKey`, `collectionId`, `routeType`
- cache status tracking
- R2 operation trend tracking
- D1 error/query tracking placeholder for later milestones
- WAF and Turnstile counters

#### Security baseline

Document and preconfigure:

- basic bot control posture
- AI Crawl Control posture
- rate-limit templates for future dynamic endpoints
- preview and prod robots policy

### Tests

- fixture-generation tests
- schema validation tests
- route resolution tests
- link checks where feasible
- CI workflow dry run

### Smoke Tests

- homepage
- browse index
- collection page
- section page
- excerpt page
- preview build on fixture corpus

### Exit Criteria

- external contributors can run the app without production secrets
- PR CI fails on integrity mismatches
- maintainers can see the minimum required runtime signals

### Risk Level

Medium

### If Bugs Appear, Look Here

- fixture generator sampling logic
- route param generation
- CI fixture download/setup scripts
- schema validator drift
- any code path that still assumes full corpus data

## M3: Runtime Data-Plane Refactor

### Goal

Stop bundling monolithic corpus metadata into the app and replace it with version-aware runtime artifacts.

### Why This Is Critical

This is the prerequisite for a clean Workers cutover and for independent dataset promotion.

### Scope

- tiny bundled bootstraps only
- canonical runtime artifacts moved to R2
- dataset pointer and manifest loaders
- section descriptor model
- in-memory isolate caching

### Implementation Details

#### What stays bundled

Bundle only the smallest bootstraps needed to route requests into the correct collection space, for example:

- collection slug to collection ID
- route existence hints
- tiny shard presence maps

Do not bundle:

- large section maps
- excerpt-to-section maps
- future relation/tag/search artifacts

#### Canonical runtime source

Canonical runtime artifacts live in R2 under the active dataset prefix selected by `prod.json` or `preview.json`.

Do not put canonical lookup shards in KV.

#### Runtime loader stack

Add small runtime modules:

- `src/lib/datasetPointer.ts`
- `src/lib/datasetManifest.ts`
- `src/lib/runtimeArtifacts.ts`
- `src/lib/runtimeCache.ts`

Expected behavior:

1. resolve the active channel pointer
2. fetch the manifest for that dataset version
3. load the needed artifact shard for the route
4. fetch the required chunk objects

#### Caching strategy

Use a two-layer strategy:

- R2 as canonical source of truth
- per-isolate in-memory cache for pointer, manifest, and hot artifact shards

Start with a short TTL for pointer and manifest cache, for example `60` seconds.

Artifact shard caches can be longer, for example `5` minutes, as long as the cache key includes dataset version.

#### Section descriptor model

Move to a descriptor model like:

`sectionId -> [{ chunkKey, start, end }]`

This is required to decouple section URLs from storage object boundaries.

A section can reference ranges within one or more chunk objects. The ETL should prefer fewer, larger chunk reads over one tiny object per section.

#### Read budget targets

Target budgets:

- excerpt route:
  - `1` chunk read on warm path
  - at most `1` extra cold artifact read on a cold isolate
- section route:
  - `1` cold descriptor-shard read on a cold isolate
  - p95 chunk fan-out target `<= 4`
  - hard cap target `<= 8`

If a section exceeds the cap, that is an ETL/chunking bug to fix, not a runtime behavior to accept.

#### Build-output rule

The compiled server bundle must no longer contain the full local `indexes.json` model as the primary runtime data source.

### Tests

- Unit tests for pointer resolution
- Unit tests for manifest resolution
- Unit tests for artifact cache keys and TTL behavior
- Contract tests for descriptor schema
- Build inspection test to confirm large local indexes are not bundled
- Route tests for collection, section, and excerpt paths

### Smoke Tests

- fixture section route on cold preview deployment
- repeated section route to confirm warm-cache behavior
- excerpt route with citation rendering
- route error handling for a missing artifact shard

### Exit Criteria

- route correctness is preserved
- the server bundle no longer depends on bundled monolithic indexes
- section fan-out stays within target budgets
- p95 TTFB does not regress beyond acceptable limits after cold/warm path measurement

### Risk Level

High

### If Bugs Appear, Look Here

- pointer cache keying
- manifest cache TTL behavior
- artifact shard path construction
- section ID normalization
- ETL range generation for `start` and `end`
- any code still importing local `src/data/*.json`

## M4: Workers Cutover

### Goal

Make Workers the only runtime path after M3 is stable.

### Scope

- replace Pages deploy path
- define preview and production environment behavior
- validate runtime bindings and static asset configuration
- perform preview and canary validation

### Implementation Details

#### Deployment changes

Replace the current deploy behavior:

- remove `wrangler pages deploy` from the canonical deploy path
- use `wrangler deploy`
- configure static assets for the Astro output

Update scripts in [`package.json`](/Users/rhaq/workspace/ilmtest.io/package.json) accordingly.

#### Preview strategy

Use two preview modes:

1. same-repo preview deployments
   - Worker preview URL
   - preview channel dataset
2. fork PR workflow
   - fixture-only CI
   - no privileged cloud preview requirement

Do not invent a complex per-branch dataset-channel system in M4.

#### Channel behavior

- production app reads `prod.json`
- shared preview app reads `preview.json`

Allow an environment override for explicit local testing of a dataset version if needed, but do not make dataset version selection ad hoc in production.

#### Cost model

Capture a simple cost model before sign-off:

- Workers request volume assumptions
- expected R2 Class B reads by route class
- preview and prod request mix

Important rule:

- cached SSR still counts as a Worker invocation
- this is acceptable as long as the volume model is explicit and the route cache behavior is correct

### Tests

- preview deployment validation
- environment binding validation
- side-by-side route correctness check against the pre-cutover path
- asset routing tests
- cache header tests

### Smoke Tests

- browse index
- collection page
- section page
- excerpt page
- robots and sitemap routes
- 404 route behavior

### Exit Criteria

- Workers deployment is stable on the core route classes
- preview workflow is acceptable for maintainers
- the canonical deploy path no longer depends on Pages

### Risk Level

High

### If Bugs Appear, Look Here

- `wrangler.jsonc` asset settings
- Astro adapter output paths
- `compatibility_date`
- route prerender flags
- preview environment variable mapping
- any deploy scripts still calling Pages commands

## M5: Search MVP

### Goal

Ship useful lexical search without introducing a server-side search dependency.

### Scope

- Pagefind via custom records
- lazy-loaded search UI
- site-wide and filtered scopes
- measured budgets
- gold-query relevance set

### Implementation Details

#### Indexing approach

Do not use the Pagefind CLI to crawl built HTML for excerpt content.

Excerpt pages are SSR, so build the index with the Node API and custom records in a script such as:

- `scripts/buildSearchIndex.ts`

Each record should include:

- canonical excerpt URL
- collection metadata
- section metadata
- Arabic text
- translation text
- lightweight display metadata for results

#### Search UI

Search must be a dedicated route or a lazily loaded island.

It must not ship its JS or index bootstrap on ordinary reading routes.

#### Search scopes

Ship:

- site-wide
- collection filter
- section filter

Defer:

- backend search
- semantic search
- advanced scholarly query syntax

#### Relevance evaluation

Create a gold query set that includes:

- Arabic exact match
- Arabic morphological variant
- Arabic with and without diacritics
- English translation query
- transliteration-like query if relevant
- collection-filtered query

Before full M5 implementation begins, run a sizing spike against the largest available corpus snapshot during late M3 or early M4. The purpose is not to ship search early; it is to confirm whether the first Pagefind implementation can stay site-wide or needs immediate collection/language segmentation.

#### Performance budgets

Budgets for the first implementation:

- no search code on default reading routes
- cold search UI bootstrap target `<= 250 KB` compressed
- cold first-query payload target `<= 1 MB` compressed
- first result target `<= 1.5 s` on throttled mobile 4G for gold queries

If the site-wide index misses these budgets:

1. segment by collection
2. then segment by language if needed
3. only then evaluate a server-side search fallback

Do not jump straight to D1 FTS.

### Tests

- unit tests for record generation
- build test for Pagefind index generation
- relevance checks against gold queries
- mobile throttling checks

### Smoke Tests

- open search UI
- run Arabic query
- run English query
- apply collection filter
- open a result deep link

### Exit Criteria

- search works on real corpus content
- search is useful for Arabic and translation queries
- payload budgets are met or a segmented-index fallback is implemented

### Risk Level

Medium

### If Bugs Appear, Look Here

- record URL generation
- record field normalization
- Arabic language handling in Pagefind records
- payload inspection
- client island lazy-loading boundaries

## M6: Relations v1

### Goal

Ship a sparse, curated relation layer without turning the hot path into a graph system.

### Scope

- entity schema
- alias schema
- relation schema
- curated source files
- generated read models
- entity pages

### Implementation Details

#### Start with a schema RFC

Before implementation, write a short schema note covering:

- entity IDs
- alias behavior
- relation types
- authoring location
- read-model output shape
- expected data volume

#### Authoring model

Curated metadata should live in version-controlled files, preferably YAML, under:

- `src/data-curated/entities/`
- `src/data-curated/relations/`

#### Generated outputs

Generate read models into dataset artifacts, not into the server bundle.

Suggested outputs:

- per-excerpt relation card payloads
- per-entity profile payloads

Do not do live graph traversal in the request path.

#### Read-path rule

Pages with no relations must not pay a relation cost.

Only fetch relation artifacts when the manifest indicates the feature is present and the current excerpt/entity actually has related data.

### Tests

- schema validation tests
- referential integrity tests
- alias collision tests
- route tests for entity pages

### Smoke Tests

- excerpt with relations
- excerpt without relations
- entity page with aliases and backlinks

### Exit Criteria

- sparse relation pages work without broad runtime scans
- relation data stays outside the main app bundle
- editorial changes are reproducible through version control

### Risk Level

Medium

### If Bugs Appear, Look Here

- alias resolution
- entity slug generation
- relation read-model generator
- missing-artifact handling in relation loaders

## M7: Taxonomy Foundation

### Goal

Add curated tags and browseable classification without creating a second entity system.

### Scope

- tree-first tag schema
- curated tag definitions
- generated tag indexes
- tag browse pages
- governance rules

### Implementation Details

Use a strict tree-first model:

- parents imply children only if explicitly defined
- no cycles
- no runtime corpus scans to build tag pages

Store curated metadata under:

- `src/data-curated/taxonomy/`

Generate tag indexes into dataset artifacts and render tag pages from those artifacts.

### Tests

- no cycle test
- no orphan parent test
- tag-to-excerpt index validation
- route tests for tag pages

### Smoke Tests

- open tag browse page
- open nested tag page
- verify tagged excerpts render

### Exit Criteria

- tag browse pages work without full scans
- governance is documented and reviewable

### Risk Level

Low-Medium

### If Bugs Appear, Look Here

- taxonomy parser
- parent-child resolution
- generated index cardinality
- tag slug normalization

## M8: Reports and Source-Backed Corrections

### Goal

Ship a small, abuse-resistant feedback loop for content issues without creating a second runtime truth source.

### Scope

- report UI
- Turnstile-protected endpoint
- D1 report queue
- moderation workflow
- source-backed correction workflow

### Implementation Details

#### Storage choice

Use D1 for:

- reports
- moderation status
- duplicate suppression
- audit timestamps

Do not store accepted corrections as runtime overlays.

Accepted corrections must become curated source updates under a path like:

- `src/data-curated/corrections/`

Then:

1. regenerate the affected data
2. publish a new dataset version
3. promote through the normal dataset pointer flow

#### Validation rules

Server-side validation must check:

- Turnstile token
- excerpt existence
- collection and section identity
- excerpt text hash against the active dataset version
- rate limit status

#### D1 schema

Keep the first schema small. Suggested tables:

- `reports`
- `report_events`

Suggested fields in `reports`:

- id
- dataset_version
- excerpt_id
- excerpt_hash
- report_type
- note
- status
- created_at
- updated_at

Add indexes for:

- `status`
- `excerpt_id`
- `dataset_version`
- duplicate suppression key

### Tests

- Turnstile verification tests using test keys
- D1 migration tests
- duplicate suppression tests
- excerpt hash validation tests
- moderation state transition tests

### Smoke Tests

- submit a valid report
- reject an invalid token
- reject a duplicate report
- mark a report accepted
- generate and publish the corrected dataset

### Exit Criteria

- spam is bounded
- moderators can review and triage reports
- accepted corrections are reproducible through the normal data pipeline
- no runtime patch layer exists

### Risk Level

Medium

### If Bugs Appear, Look Here

- Turnstile server verification
- D1 indexes and uniqueness constraints
- excerpt hash generation
- mapping between moderation action and source correction file
- dataset republish trigger path

## M9: Discoverability, Arabic Hardening, and Release Gates

### Goal

Turn launch-quality concerns into explicit gates rather than optional polish.

### Scope

- sitemap strategy
- canonical tags
- structured data
- font subset coverage
- RTL regressions
- robots and AI crawler policy

### Implementation Details

#### Discoverability

Ship:

- sitemap index
- segmented sitemaps
- canonical URLs
- breadcrumb structured data
- book/section/excerpt structured data where stable

Preview deployments must be clearly non-indexable.

#### Arabic hardening

Add:

- font subset manifest
- glyph coverage test
- RTL regression fixtures
- browser matrix checks
- screen-reader smoke checks for core routes

The glyph coverage test must include the ranges actually needed for the corpus, including scholarly Arabic marks that are easy to drop by accident.

#### Policy

Document:

- robots policy
- AI crawler policy
- any WAF policy related to AI Crawl Control

### Tests

- sitemap validation
- Lighthouse accessibility pass
- glyph coverage checks
- browser matrix checks

### Smoke Tests

- open sitemap index
- open collection sitemap
- inspect canonical tags
- inspect structured data
- render Arabic-heavy fixture pages in supported browsers

### Exit Criteria

- preview is not indexable
- production pages have correct discoverability metadata
- Arabic font and rendering regressions are caught before release

### Risk Level

Low-Medium

### If Bugs Appear, Look Here

- sitemap generation logic
- canonical URL builder
- structured data serializer
- font subset generation inputs
- browser-specific RTL CSS

## Deferred: Inline Mentions

### Decision

Inline mentions are explicitly deferred out of the current implementation path.

### Why

- Arabic rendering risk is high
- anchor repair is not yet proven
- there is no editorial workflow yet for authoring and repairing anchors
- the user value is lower than search, relations, taxonomy, and reports

### What Can Still Be Done Now

Only do lightweight prerequisite work:

- keep entity IDs stable
- avoid storing inline markup in corpus text
- leave room in the schema for future standoff annotations

Do not build render-time inline mention materialization in this phase.

## Global Test Strategy

This applies across milestones:

### Unit / contract layer

- schema validators
- manifest and pointer parsing
- search record generation
- relation/tag read-model generation
- report dedupe and validation

### Integration layer

- fixture ETL
- dataset publish to non-prod prefix
- runtime loader behavior against fixture artifacts
- D1 migration and report flow

### Route smoke layer

Always keep these route checks:

- homepage
- browse index
- collection page
- section page
- excerpt page
- robots route
- sitemap route

Add search, entity, tag, and report checks once those features exist.

### Preview / canary layer

Before any milestone that touches the request path is considered complete:

- deploy preview
- run smoke tests
- inspect logs
- verify dataset version and manifest in logs

## Release Discipline

At the end of each milestone:

1. update the relevant docs and runbooks
2. record the new known-good dataset version if applicable
3. record the rollback step
4. note any unresolved risks before starting the next milestone
5. confirm that the active manifest still pins one compatible artifact set for runtime resolution

## What Is Explicitly Out of Scope

- auth and user accounts
- semantic search
- vector databases
- live graph traversal
- runtime correction overlays
- Pages as a planned runtime fallback
- inline mentions in the first implementation cycle
