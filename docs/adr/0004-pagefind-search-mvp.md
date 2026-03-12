# ADR 0004: Pagefind Is The Search MVP

- Status: Accepted
- Date: 2026-03-12

## Decision

The first search implementation will use Pagefind custom records. The project will not jump directly to server-side search for the MVP.

## Consequences

- Search indexing can be built offline from corpus artifacts.
- Default reading routes stay low-JS because search remains isolated from the hot path.
- Relevance and payload budgets must be measured before considering a fallback.
