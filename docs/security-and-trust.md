# Security and trust

## What data leaves the machine

| Feature | Data sent | To where |
|---|---|---|
| `scan` (static pass) | Nothing | n/a |
| `npm audit` | Package names/versions from the lockfile (npm's standard behaviour) | npm registry |
| Reports/history | Nothing; written to local disk | n/a |
| LLM features (M6+, opt-in) | Diff, dependent file contents, static findings | The LLM provider the user configures, using the user's key |

No telemetry, no accounts, no update pings. Before any LLM call the tool must show what will be sent and redact detected secrets.

## What Foreman stores

- `foreman-report/` output (may contain code snippets and file paths; treat as confidential client material).
- `.foreman/history.json`: timestamps, scores, counts only.

## What Foreman is NOT

- Not a security audit, penetration test or compliance certification.
- Not proof that code is secure. A high score means the checked rules found little, nothing more.
- Not a substitute for human review on high-risk systems.

Reports state which checks ran, which were skipped, and which checklist items are unverified. The client-ready report must use wording like "review completed" and never "certified secure".

## Handling of scanned code

Read-only. Never executed, never modified (NFR-07).

## Reporting vulnerabilities in Foreman

Use GitHub private vulnerability reporting on the repo (enable it). Do not file public issues for security bugs.
