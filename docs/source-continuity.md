# Source Continuity

This note captures the `M0` continuity rules for corpus inputs and release reproducibility.

## Source Pinning

- `scripts/setup.ts` records dataset provenance in `tmp/dataset-build/metadata.json`.
- `HF_EXCERPT_REVISION`, `HF_ASL_REVISION`, and `HF_SHAMELA4_REVISION` default to `main` for local work.
- When `RELEASE_BUILD=1`, all three Hugging Face revision env vars are required and must be pinned explicitly.
- `@ilmtest/ilmtest-sdk-js` is pinned through `package.json` and copied into dataset metadata as part of the build.

## Release Inputs

- Local fixture and exploratory runs materialize generated corpus artifacts under `src/data/`, `tmp/excerpt-chunks/`, `tmp/runtime-artifacts/`, and `tmp/dataset-build/`.
- Release runs should treat `tmp/dataset-build/metadata.json` as the publishing contract and archive it with release records.
- Raw Hugging Face downloads and decompressed job-local inputs are considered ephemeral workspace state during a release job; if a release needs long-term replayability beyond metadata and git revision pinning, archive the job workspace or CI artifact bundle outside the app runtime.

## Release Expectations

- Do not publish a release dataset from floating source revisions.
- Do not change SDK versions, dataset revisions, and dataset publish outputs in separate untracked steps.
- Preserve the generated `metadata.json`, published `manifest.json`, and promoted channel pointer together for every production publish or rollback event.
