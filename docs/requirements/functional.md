# Functional requirements

Phase: **MVP** = M1-M5, **Post** = later. IDs are permanent.

## Core scan (MVP)

| ID | Requirement | Phase |
|---|---|---|
| FR-01 | `foreman scan [path]` scans a Node repo (default cwd) and prints a terminal report. | MVP |
| FR-02 | Parse the project with ts-morph (JS and TS) without executing it. | MVP |
| FR-03 | Express adapter: discover routes (method, path, params), middleware chains, and app-level middleware. | MVP |
| FR-04 | Secrets check: detect hardcoded secrets/keys/tokens/passwords in source and committed env files. | MVP |
| FR-05 | Injection check: detect SQL built via string concatenation/template interpolation with non-constant input. | MVP |
| FR-06 | Validation check: flag route params/body/query used without validation. | MVP |
| FR-07 | Auth check: flag sensitive routes (admin, write, user-data) with no auth middleware. Sensitivity heuristics are configurable. | MVP |
| FR-08 | Dependency check: run `npm audit`, reformat results into findings. Degrade gracefully when offline. | MVP |
| FR-09 | Config check: debug mode on, no HTTPS redirect, permissive CORS, default/example credentials. | MVP |
| FR-10 | Go-live checklist: roll findings up into fixed items (see lld.md); all green = "ready to ship". | MVP |
| FR-11 | Health score 0-100 from weighted findings; weights configurable. | MVP |
| FR-12 | Each finding has: id, severity, confidence, file/line, message, remediation. | MVP |
| FR-13 | Exit code non-zero when blockers exist or score below `--fail-under`, for CI use. | MVP |
| FR-14 | `--report=html` writes one self-contained static HTML file; `--report=md` writes Markdown; `--format=json` emits machine-readable output. | MVP |
| FR-15 | `foreman scan --all <glob>` scans many projects and prints one summary table (score, trend, last scanned); optional combined HTML. | MVP (M5) |
| FR-16 | Per-project local history file so trend arrow and last-scanned can be shown. | MVP (M5) |
| FR-17 | Optional project context file passed with `--context`. | MVP |
| FR-18 | Inline suppression and ignore config with required reason string. | MVP |
| FR-19 | `foreman init` creates config and optionally a sample GitHub Action / cron snippet. | MVP (M5) |

## Post-MVP

| ID | Requirement | Phase |
|---|---|---|
| FR-20 | Senior review: review a diff with dependent files (imports, route, model) pulled in as context. | M6 |
| FR-21 | Review reasons stepwise (intent, hostile input, what is missing, consistency) and feeds static findings in as facts. | M6 |
| FR-22 | Every review comment carries confidence; low confidence is phrased as "worth a second look". | M6 |
| FR-23 | Developer can reply to a comment ("why", "intentional because X") and the engine responds. | M6 |
| FR-24 | Review comments tagged Blocker / Should-fix / Nice-to-have. | M6 |
| FR-25 | Risk-in-money: plain-English business consequence per finding. | M7 |
| FR-26 | Brandable client-ready report ("review completed on [date], N checked, N resolved"). | M7 |
| FR-27 | Care mode: sample cron and GitHub Action running scan weekly/monthly and notifying on score drop or new CVE. | M8 |
| FR-28 | `foreman explain`: plain-language walkthrough of an unfamiliar codebase, risky patterns, pre-work fixes. | M9 |
| FR-29 | Adapters for NestJS, Fastify, Next.js. | M10+ |
| FR-30 | PDF export of the client report. | Later |
