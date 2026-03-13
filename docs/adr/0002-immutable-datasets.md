# ADR 0002: Publish Immutable Datasets

- Status: Accepted
- Date: 2026-03-12

## Decision

Corpus artifacts are published under immutable R2 prefixes using `datasets/<datasetVersion>/...`. Mutable names such as `latest` are not used for canonical dataset storage.

## Consequences

- Publishing is resumable and verifiable without exposing partially updated live data.
- Rollback moves a pointer to an older immutable dataset instead of rewriting objects in place.
- Runtime migration can happen independently of the publishing lane because datasets are versioned before they are consumed.
