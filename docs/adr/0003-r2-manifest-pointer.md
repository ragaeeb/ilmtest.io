# ADR 0003: R2 Manifest And Pointer Select The Active Dataset

- Status: Accepted
- Date: 2026-03-12

## Decision

The active dataset is selected by small pointer objects in R2 (`channels/prod.json` and `channels/preview.json`) that reference a dataset manifest stored under the immutable dataset prefix.

## Consequences

- Promotion and rollback become pointer updates, not bulk object rewrites.
- Runtime code can resolve a single manifest-selected artifact set without relying on KV coherence.
- Audit history is stored as immutable channel history records alongside the live pointers.
