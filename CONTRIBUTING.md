# Contributing

## Ground rules

- Read [docs/00-overview.md](docs/00-overview.md) first.
- Be kind: see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security issues privately per [SECURITY.md](SECURITY.md).
- Open an issue before large changes. Anything that changes scope or architecture needs a new ADR in `docs/decisions/adr/`.
- Keep PRs small and tied to an FR/NFR ID.

## Adding a rule

1. Pick an ID: `<category>/<kebab-name>` (e.g. `secrets/hardcoded-api-key`). IDs are permanent.
2. Add it to `src/rules/catalog.ts` with a severity, an honest confidence level and fix text.
3. Implement it in a rule group under `src/rules/` following the `Rule` interface in [lld.md](docs/design/lld.md), and list its ID in the group's `ids`.
4. Add a must-fire and a must-not-fire test in `tests/rules.test.ts`. Build fake secrets from fragments (see `tests/helpers.ts`); never commit a secret-shaped string.
5. If it feeds a go-live item, map it in `src/score.ts` and in lld.md.
6. Write the detection yourself. Do not copy patterns or rule text from other scanners unless their licence allows it and you say so in the PR.
7. Add a CHANGELOG entry.

## Adding a framework adapter

Implement the `FrameworkAdapter` interface (routes, middleware, models). Rules must stay framework-agnostic and consume only the adapter's normalized output. Add an ADR if the interface needs to change.

## Before you push

```bash
npm run hooks    # once per clone: turns on the pre-commit and pre-push hooks in .githooks/
npm run check    # types, tests, build, a scan of this repository, package contents, dependency audit
```

CI runs the same `check`. What each step guards against is in [docs/security/safeguards.md](docs/security/safeguards.md).

## Security-sensitive code

The project being scanned is hostile input: someone else wrote it, and may have built it to attack or mislead the scanner ([docs/security-and-trust.md](docs/security-and-trust.md)). Four rules follow. A pull request that breaks one will not be merged.

1. **Never start a program by name.** Use `findProgram` and `childEnv` from `src/exec.ts`. On Windows a bare `git` or `npm` is looked up in the project folder first.
2. **Never write a file with `fs` directly.** Use `writeInside` or `writeReportFile` from `src/fsafe.ts`, which refuse links and paths outside the base folder.
3. **Never print or store text from the project as it is.** File names, route paths and package names go through `clipped` or `printable` from `src/text.ts`; HTML goes through `escapeHtml`.
4. **Never run an open-ended pattern over a whole line or file.** A pattern of the form "a run of characters, then something that may be missing" is quadratic on a long line. Bound the input, or walk it (see `urlPassword` in `src/rules/secrets.ts`).

And two habits: nothing from `foreman.config.json` may reach outside the project folder, and a check that could not run must show as `unverified` or a warning, never as a pass. Add a test to `tests/security.test.ts` for anything in this area.

## Contracts you must not break

- Rule IDs, checklist item IDs
- JSON report schema (`schemaVersion`)
- CLI flags and exit codes
- Config file keys

Breaking any of these requires a major version bump and a deprecation note ([release-process.md](docs/release-process.md)).

## Licensing of contributions

By contributing you confirm the work is your own and you license it under the project's MIT licence. See [docs/legal.md](docs/legal.md).

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Reference the FR/NFR ID in the body.
