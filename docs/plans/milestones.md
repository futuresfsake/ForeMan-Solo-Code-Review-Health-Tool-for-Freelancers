# Milestones

Exit criteria must be runnable or checkable.

## Status (2026-11-11)

| ID | Status | Notes |
|---|---|---|
| M1 | Done | CLI, loader, parser, ignore handling; verified by `tests/cli.test.ts`, `tests/scan.test.ts` |
| M2 | Done | Express adapter; verified by `tests/express.test.ts` |
| M3 | Done | All MVP rules, audit wrapper, score, checklist, suppressions, exit codes; verified by `tests/rules.test.ts`, `tests/scan.test.ts` |
| M4 | Met on substitute projects | All outputs are done. Validated on three open-source Express apps with every finding checked by hand ([validation-results.md](../testing/validation-results.md)). Still to do: repeat on the author's own project when one exists |
| M5 | Done | `scan --all`, history and trend, `foreman-solo init`, and `init --ci` for a GitHub Actions workflow; verified by `tests/cli.test.ts`, `tests/init-client.test.ts` |
| M6 | Built, experimental | `foreman-solo review` on local Ollama (ADR-0007): context builder, tagged comments with confidence, secret masking, `--dry-run`, and reply round-trip; verified by `tests/review.test.ts` with a fake model. Tried once on a real `qwen2.5-coder:7b`: it works end to end but the small model mostly restates scanner findings and generic advice, and missed a seeded business-logic bug. A hosted provider is not built |
| M7 | Done | Plain-English risk text for every rule, and `--report client` with "prepared by", client name, logo and accent colour; verified by `tests/init-client.test.ts` |
| M8 | Done as a sample | `init --ci` writes a workflow that scans on push and weekly and fails on blockers or a low score. It relies on the npm package, which is not published yet |
| M9 | Not started | `explain` can now reuse the M6 context builder and provider |
| M10 | Done for NestJS, on fixtures | NestJS adapter; auth and rate-limit rules run on it unchanged; verified by `tests/nestjs.test.ts`. Not yet run on a real Nest project; Fastify and Next.js not started |

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
