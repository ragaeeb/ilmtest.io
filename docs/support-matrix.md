# Support Matrix

This note captures the `M0` support and responsibility boundaries for local, CI, and cloud workflows.

## Tooling Versions

- Bun: `>=1.3.10`
- Node: `>=25.0.0`
- Wrangler: `^4.72.0` in `devDependencies`

Use the versions in `package.json` as the canonical floor unless a later ADR changes them.

## Responsibilities

- Local:
  - materialize fixture corpora
  - run lint, typecheck, tests, integrity, build, and smoke checks
  - validate local datasets with `DATASET_STORE_ROOT` or local generated artifacts
- CI:
  - run contributor, maintainer, and release lanes
  - publish baseline artifacts
  - gate merges on lint, typecheck, tests, integrity, build, and smoke checks
- Cloud:
  - host the `EXCERPT_BUCKET` R2 binding
  - store immutable dataset prefixes and `channels/*.json`
  - enforce Cloudflare security controls and runtime bindings

## Required Environment Variables

### Fixture and local QA

- none required for `bun run setup-fixture -- tiny|medium`

### Full ETL / release build

- `HF_TOKEN`
- `HF_EXCERPT_STORE`
- `HF_ASL_STORE`
- `HF_SHAMELA4_STORE`
- `HF_EXCERPT_REVISION` when `RELEASE_BUILD=1`
- `HF_ASL_REVISION` when `RELEASE_BUILD=1`
- `HF_SHAMELA4_REVISION` when `RELEASE_BUILD=1`
- `ILMTEST_API_URL`

### Dataset publish / validation against R2

- `R2_BUCKET`
- `R2_ENDPOINT` or `R2_ACCOUNT_ID` / `CF_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

### App runtime / Cloudflare

- `EXCERPT_BUCKET` binding in Workers runtime
- `ILMTEST_RUNTIME_CHANNEL=prod|preview`
- `PUBLIC_ROBOTS_POLICY` optional
- `PUBLIC_AI_CRAWL_POLICY` optional
- `ILMTEST_DATASET_VERSION_OVERRIDE` optional for preview/dev validation only

## Policy Notes

- Use fixture corpora for contributor-safe validation.
- Reserve production dataset promotion and rollback commands for maintainers.
- Treat `upload-r2` and `resume` as compatibility tooling, not the canonical deploy lane.
