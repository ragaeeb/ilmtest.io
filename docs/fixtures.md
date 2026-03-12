# Fixture Corpus Workflow

The `M2` fixture tiers let contributors exercise the app, dataset validator, and route path without Hugging Face or R2 credentials.

## Fixture Tiers

- `tiny`: fast enough for every PR. It contains one Shamela-like collection and one web-like collection with enough sections and excerpts to exercise route generation, heading markers, bilingual content, citation metadata, and chunk boundaries.
- `medium`: maintainer validation corpus. It contains one Shamela-like collection and one web-like collection with `100` sections each to catch assumptions that only show up with larger indexes.

## Commands

- `bun run setup-fixture -- tiny`
- `bun run setup-fixture -- medium`
- `bun run integrity`
- `bun run smoke-routes`

`setup-fixture` rewrites the generated local runtime inputs in `src/data/`, `tmp/excerpt-chunks/`, and `tmp/dataset-build/metadata.json`. Run it in a clean worktree or regenerate the full corpus afterward with `bun run setup`.

## What The Fixtures Preserve

- hierarchical-style section titles
- bilingual Arabic/English excerpt content
- hadith, book, Qur'an, and web citation shapes
- multi-chunk sections
- collection, section, and excerpt route generation

## Recommended Local Flow

1. `bun run clean`
2. `bun run setup-fixture -- tiny`
3. `bun run validate-dataset`
4. `bun run integrity`
5. `bun run build`
6. `bun run smoke-routes`
