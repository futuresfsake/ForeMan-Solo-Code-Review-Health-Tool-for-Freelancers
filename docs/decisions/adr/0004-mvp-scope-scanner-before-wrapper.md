# ADR-0004: MVP is the scanner; wrappers come after it proves useful

- Status: Accepted (2026-11-11)

## Context

Risk: building a polished shell (reports, dashboards, narratives) around a scanner that catches nothing.

## Decision

MVP = `scan`, Express adapter, secrets/injection/validation/auth/deps/config checks, go-live checklist, score, terminal + HTML/MD output, plus `scan --all`. First acceptance test is running it on one of the author's own live projects and checking for true findings and tolerable false positives. LLM review, risk narratives, branding, care-mode samples, explain mode and other frameworks follow only after that loop is fixed.

## Consequences

- Milestone M4 is a hard gate before M5+.
- False-positive rate is a tracked metric (NFR-06).
