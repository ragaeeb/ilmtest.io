# ADR 0005: D1 Backs Moderated Reports

- Status: Accepted
- Date: 2026-03-12

## Decision

Moderated content reports will use D1. Accepted corrections will not be runtime overlays; they will become source-backed updates followed by regeneration and republish.

## Consequences

- Moderation state stays operationally simple and queryable.
- Runtime truth continues to come from regenerated corpus artifacts.
- Abuse controls such as Turnstile and rate limits can be added without changing the data plane decision.
