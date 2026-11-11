# Tech stack

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript on Node 20+, ES modules | The audience is Node developers; strict types catch mistakes in rule code |
| CLI | commander | Small, standard, good subcommand support |
| Parsing | TypeScript compiler API (`ts.createSourceFile`) | Parses JS, TS and JSX one file at a time without type-checking; tolerant of syntax errors (ADR-0006) |
| Dependency audit | `npm audit --json` | No extra service; data the audience already trusts |
| Tests | vitest | Fast, TypeScript-native |
| Lint | `tsc --noEmit` (strict) | Type-check as the lint step for now; ESLint/Prettier deferred (ADR-0006) |
| Build | `tsc` to `dist/` | No bundler, so no third-party code is copied into the package |
| HTML report | Hand-built template, inline CSS, no JavaScript | Self-contained, works offline, nothing to load |
| Distribution | npm package `foreman-solo`, one bin `foreman-solo` | `foreman` is taken on npm and used by other tools (ADR-0005, ADR-0006). Not published yet |
| LLM (post-MVP) | Provider-agnostic interface; user supplies key | No lock-in, opt-in |

Runtime dependencies: `commander` and `typescript`. Nothing else.

## Deliberately NOT used

| Not used | Reason |
|---|---|
| Hosted backend / database | Decision: CLI only (ADR-0001) |
| Running the target app | Must work without booting, a database or test data |
| ts-morph | Only parsing is needed; the raw compiler API is lighter and faster to start (ADR-0006) |
| tree-sitter | Native binaries complicate `npx`; revisit for non-JS/TS languages |
| Regex-only scanning | Too many false positives; AST first. Regex is used only for well-known key formats |
| Semgrep as the engine | Extra binary dependency; maybe a later import/export target |
| A glob, colour or template library | A few dozen lines each; fewer dependencies to audit |
| React/SPA for the report | A static file needs no framework |
| Telemetry/analytics | Trust is the selling point |
