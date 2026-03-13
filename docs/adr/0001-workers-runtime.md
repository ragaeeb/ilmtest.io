# ADR 0001: Workers Is The Target Runtime

- Status: Accepted
- Date: 2026-03-12

## Decision

Cloudflare Workers is the target runtime for IlmTest. Cloudflare Pages remains current-state and legacy deployment context until the `M4` cutover is complete.

## Consequences

- Runtime work should optimize for Workers bindings, R2 reads, and manifest-selected datasets.
- Pages-specific deployment instructions remain documented only for continuity during the transition.
- No parallel long-term Pages fallback will be maintained once the Workers cutover is complete.
