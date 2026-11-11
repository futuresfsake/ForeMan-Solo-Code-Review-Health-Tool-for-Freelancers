# Milestones

Exit criteria must be runnable or checkable.

| ID | Scope | Exit criteria |
|---|---|---|
| M1 | Repo setup, TS/vitest/eslint, commander CLI, project loader, ts-morph parse, ignore handling | `npx foreman-solo scan ./fixtures/empty` exits 0 and prints "0 findings"; unparsable file yields a warning not a crash; `npm test` green (FR-01, FR-02, NFR-08) |
| M2 | Express adapter, `ProjectModel` | Fixture express app: all routes, params and middleware chains match expected JSON snapshot (FR-03) |
| M3 | All MVP rules, `npm audit` wrapper, config checks, score, checklist, suppressions, exit codes | Every rule has bad+good fixtures passing; `--no-audit` works offline; checklist shows GL-04 `unverified` until attested; same input twice gives identical JSON (FR-04..13, 18, NFR-02) |
| M4 | Terminal report, HTML/MD/JSON output, **validation on a real live project** | HTML opens offline with no external requests; run on capstone/Resibo: >=1 true finding confirmed manually, false positives <= 3, each logged as an issue or fixed (FR-14, NFR-06, NFR-09). **Gate.** |
| M5 | `scan --all`, history/trend, `foreman init`, sample GitHub Action | `foreman scan --all ./fixtures/clients/*` prints table with score, trend arrow, last-scanned; second run shows trend; `init` writes valid config (FR-15,16,19) |
| M6 | Context builder, LLM review, confidence, pushback | On a seeded diff, review pulls in dependent files and emits tagged comments with confidence; reply round-trip works (FR-20..24) |
| M7 | Risk-in-money text, branded client report | Every rule ID has a business-consequence string; report renders with brand file (FR-25, 26) |
| M8 | Care-mode samples | Sample cron + Action run scan, detect an injected vulnerable dep, and fail (FR-27) |
| M9 | `foreman explain` | On an unfamiliar sample repo, produces walkthrough + risk list (FR-28) |
| M10 | NestJS adapter first | Same rules run on a Nest fixture with no rule changes (FR-29, NFR-12) |

Target dates: MVP (M1-M4) due before the author's other deadlines; set concrete dates here once capacity is known.
