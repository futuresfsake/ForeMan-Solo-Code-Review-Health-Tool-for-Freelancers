# Contributing

## Ground rules

- Read [docs/00-overview.md](docs/00-overview.md) first.
- Be kind: see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security issues privately per [SECURITY.md](SECURITY.md).
- Open an issue before large changes. Anything that changes scope or architecture needs a new ADR in `docs/decisions/adr/`.
- Keep PRs small and tied to an FR/NFR ID.

## Adding a rule

1. Pick an ID: `<category>/<kebab-name>` (e.g. `secrets/hardcoded-api-key`). IDs are permanent.
2. Implement it under `src/rules/<category>/` following the `Rule` interface in [lld.md](docs/design/lld.md).
3. Add fixtures: `tests/fixtures/<rule-id>/bad/` (must fire) and `good/` (must not fire).
4. Add the rule to the weight table in [configuration.md](docs/tech/configuration.md) if it affects the score.
5. If it feeds a go-live item, map it in lld.md.
6. Add a CHANGELOG entry.

## Adding a framework adapter

Implement the `FrameworkAdapter` interface (routes, middleware, models). Rules must stay framework-agnostic and consume only the adapter's normalized output. Add an ADR if the interface needs to change.

## Contracts you must not break

- Rule IDs, checklist item IDs
- JSON report schema (`schemaVersion`)
- CLI flags and exit codes
- Config file keys

Breaking any of these requires a major version bump and a deprecation note ([release-process.md](docs/release-process.md)).

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Reference the FR/NFR ID in the body.
