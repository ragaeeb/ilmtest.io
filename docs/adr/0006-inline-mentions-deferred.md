# ADR 0006: Inline Mentions Are Deferred

- Status: Accepted
- Date: 2026-03-12

## Decision

Inline mentions are explicitly deferred out of the current implementation path.

## Consequences

- The project avoids high-risk Arabic rendering and anchor-repair work in the current milestone set.
- Entity IDs and relation schemas should remain stable enough to support future standoff annotations.
- Search, relations, taxonomy, reports, and release hardening stay ahead of inline mention work.
