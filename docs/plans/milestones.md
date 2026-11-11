# Milestones

Exit criteria must be runnable or checkable.

## Status (2026-11-11)

| ID | Status | Notes |
|---|---|---|
| M1 | Done | CLI, loader, parser, ignore handling; verified by `tests/cli.test.ts`, `tests/scan.test.ts` |
| M2 | Done | Express adapter; verified by `tests/express.test.ts` |
| M3 | Done | All MVP rules, audit wrapper, score, checklist, suppressions, exit codes; verified by `tests/rules.test.ts`, `tests/scan.test.ts` |
| M4 | **Open (gate)** | Terminal, HTML, Markdown and JSON output are done. Validation on a real live project has **not** been done yet; only a synthetic demo app was scanned |
| M5 | Partly done | `scan --all`, history and trend are done. `foreman-solo init` and the sample GitHub Action are not |
| M6-M10 | Not started | Blocked on the M4 gate |

## Scope and exit criteria

| ID | Scope | Exit criteria |
|---|---|---|
| M1 | Repo setup, TypeScript/vitest, commander CLI, project loader, parsing, ignore handling | Scanning an empty project exits 0 and prints "No open findings"; an unparsable file yields a warning not a crash; `npm test` green (FR-01, FR-02, NFR-08) |
| M2 | Express adapter, `ProjectModel` | Fixture Express apps: routes, params, mounts and middleware chains match expectations (FR-03) |
| M3 | All MVP rules, `npm audit` wrapper, config checks, score, checklist, suppressions, exit codes | Every rule has must-fire and must-not-fire tests; `--no-audit` works offline; checklist shows GL-04 `unverified` until attested; same input twice gives identical JSON (FR-04..13, 18, NFR-02) |
| M4 | Terminal report, HTML/MD/JSON output, **validation on a real live project** | HTML opens offline with no external requests; run on capstone/Resibo: >=1 true finding confirmed manually, false positives <= 3, each logged as an issue or fixed (FR-14, NFR-06, NFR-09). **Gate.** |
| M5 | `scan --all`, history/trend, `foreman-solo init`, sample GitHub Action | `foreman-solo scan --all "./clients/*"` prints a table with score, trend and previous-scan date; a second run shows the trend; `init` writes a valid config (FR-15,16,19) |
| M6 | Context builder, LLM review, confidence, pushback | On a seeded diff, review pulls in dependent files and emits tagged comments with confidence; reply round-trip works (FR-20..24) |
| M7 | Risk-in-money text, branded client report | Every rule ID has a business-consequence string; report renders with brand file (FR-25, 26) |
| M8 | Care-mode samples | Sample cron + Action run scan, detect an injected vulnerable dep, and fail (FR-27) |
| M9 | `foreman-solo explain` | On an unfamiliar sample repo, produces walkthrough + risk list (FR-28) |
| M10 | NestJS adapter first | Same rules run on a Nest fixture with no rule changes (FR-29, NFR-12) |

Target dates: not set. Add them here once capacity is known.
