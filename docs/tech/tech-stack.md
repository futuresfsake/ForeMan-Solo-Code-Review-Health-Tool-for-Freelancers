# Tech stack

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript on Node 20+ | Target audience is Node devs; same ecosystem as ts-morph |
| CLI | commander | Small, standard, good subcommand support |
| Parsing | ts-morph | Full TS/JS AST plus type info and import resolution (needed for context-aware review later) |
| Dependency audit | `npm audit --json` | Zero extra service, data already trusted by the audience |
| Tests | vitest | Fast, TS-native |
| Lint/format | eslint + prettier | Standard |
| Build | tsup | Single bundle for npx startup speed |
| HTML report | Hand-built template, inline CSS | Self-contained, no framework needed |
| Distribution | npm package `foreman-solo` (`foreman` is taken by an unrelated package; checked 2026-11-11), bins `foreman-solo` and `foreman` (ADR-0005) | `npx foreman-solo scan` |
| LLM (post-MVP) | Provider-agnostic interface; user supplies key | No lock-in, opt-in |

## Deliberately NOT used

| Not used | Reason |
|---|---|
| Hosted backend / database | Decision: CLI only (ADR-0001) |
| Running the target app | Must work without booting, DB or test data |
| tree-sitter (MVP) | ts-morph gives type info; revisit for non-JS/TS or perf (ADR-0003) |
| Regex-only scanning | Too many false positives; AST first |
| Semgrep as the engine | Extra binary dependency; maybe a later import/export target |
| React/SPA for the report | A static file needs no framework |
| Telemetry/analytics | Trust is the selling point |
