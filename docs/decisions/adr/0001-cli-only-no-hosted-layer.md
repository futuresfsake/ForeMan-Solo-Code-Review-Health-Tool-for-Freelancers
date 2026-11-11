# ADR-0001: CLI only, no hosted layer

- Status: Accepted (2026-11-11)
- Supersedes: the "open-core" form factor and monetization tiers in the original brief

## Context

The original brief described two products: a free CLI plus a paid hosted dashboard (Solo/Studio tiers). A later section of the same brief decided on CLI only. The two conflict.

## Decision

Foreman Solo is a single open-source npm CLI. No server, accounts, hosted frontend or telemetry. "Frontend" is terminal output plus a static HTML file. Multi-client view is `scan --all`. Ongoing care is a sample cron/GitHub Action.

## Consequences

- No infrastructure to run or pay for; easy for freelancers to trust.
- Features needing a persistent service (shared history, scheduling, teams) are replaced by local files and CI.
- No paid tier. Monetization tiers in the brief are archived, not planned. Revisit only through a new ADR.
- LLM features (post-MVP) are opt-in and use the user's own key.
