# Security and trust

## What data leaves the machine

| Feature | Data sent | To where |
|---|---|---|
| `scan` (static pass) | Nothing | n/a |
| `npm audit` | Package names/versions from the lockfile (npm's standard behaviour) | npm registry |
| Reports/history | Nothing; written to local disk | n/a |
| `foreman-solo review` (opt-in) | The git diff, related source files and the scan's findings, with secrets masked | A model on this machine through Ollama (`localhost` only). `scan` never does this |

No telemetry, no accounts, no update pings. Before anything is put in an LLM prompt, detected secrets are masked, and `foreman-solo review --dry-run` prints exactly what would be sent without sending it. The masking is a safety net: a secret the scan cannot recognise is not masked. The only provider today runs on this machine and non-local endpoints are rejected. If a hosted provider is ever added, it must show what will be sent and ask for explicit consent first. `.foreman/review.json` holds the model's comments; it is git-ignored by `init`.

## What Foreman stores

- `foreman-report/` output (may contain code snippets and file paths; treat as confidential client material).
- `.foreman/history.json`: timestamps, scores, counts only.

## What Foreman is NOT

- Not a security audit, penetration test or compliance certification.
- Not proof that code is secure. A high score means the checked rules found little, nothing more.
- Not a substitute for human review on high-risk systems.

See [legal.md](legal.md) for licence, disclaimer and trademark notes.

Reports state which checks ran, which were skipped, and which checklist items are unverified. The client-ready report must use wording like "review completed" and never "certified secure".

## Handling of scanned code

Read-only. Never executed, never modified (NFR-07).

## Reporting vulnerabilities in Foreman

Use GitHub private vulnerability reporting on the repo (enable it). Do not file public issues for security bugs.
