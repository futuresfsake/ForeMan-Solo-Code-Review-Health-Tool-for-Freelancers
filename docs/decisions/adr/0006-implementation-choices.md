# ADR-0006: Implementation choices made while building the MVP

- Status: Accepted (2026-11-11)
- Supersedes: the parser choice in ADR-0003 and the short bin in ADR-0005

## Context

Building M1 to M4 exposed a few places where the first design was heavier or riskier than it needed to be.

## Decisions

1. **TypeScript compiler API instead of ts-morph.** The scanner only needs to parse files, never type-check them. `ts.createSourceFile` parses one file at a time, tolerates syntax errors, and removes a dependency layer, which keeps `npx` startup fast. ts-morph can come back if the LLM review layer needs type information.
2. **One command name: `foreman-solo`.** The short `foreman` bin is not shipped. An unrelated npm package and a well-known infrastructure project already use that name, so a short bin could overwrite another tool on a user's machine and invites confusion about affiliation.
3. **Plain `tsc` build, no bundler.** Dependencies stay as normal npm dependencies and are not copied into the published package, so there is no third-party code to re-license or attribute inside the tarball.
4. **Two runtime dependencies only:** `commander` (MIT) and `typescript` (Apache-2.0). Globbing, colours and HTML are small in-house modules.
5. **Heuristic rules carry lower confidence.** Rules that guess from names or patterns report `medium` or `low` confidence and score less. Exact matches report `high`.
6. **One rule catalog** (`src/rules/catalog.ts`) holds every rule ID, default severity, confidence and fix text.
7. **Test fixtures are generated at runtime** in a temp folder, and fake credentials are assembled from fragments, so no secret-shaped string is ever committed.
8. **Secrets are redacted** in every output (first four characters and the length).
9. **Reports never contain absolute local paths**, only the project name and project-relative file paths.
10. **`lint` is a strict type-check for now.** ESLint and Prettier are deferred until there is more than one contributor.

## Consequences

- No type information is available to rules; cross-file data flow stays out of scope for the static pass.
- Users type the longer `foreman-solo`.
- ADR-0003's adapter design and ADR-0005's product and package names are unchanged.
