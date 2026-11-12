# Security and trust

## What data leaves the machine

| Feature | Data sent | To where |
|---|---|---|
| `scan` (static pass) | Nothing | n/a |
| `npm audit` | Package names/versions from the lockfile (npm's standard behaviour) | npm registry |
| Reports/history | Nothing; written to local disk | n/a |
| `foreman-solo review` (opt-in) | The git diff, related source files and the scan's findings, with secrets masked | A model on this machine through Ollama (`localhost` only). `scan` never does this |
| `foreman-solo explain` (opt-in) | Project name, script and dependency names, file names, routes, the scan's findings and the start of the most connected source files, with secrets masked | The same local model. `scan` never does this |

No telemetry, no accounts, no update pings. Before anything is put in an LLM prompt, detected secrets are masked, and `--dry-run` on `review` and `explain` prints exactly what would be sent without sending it. The masking is a safety net: a secret the scan cannot recognise is not masked. If a hosted provider is ever added, it must show what will be sent and ask for explicit consent first. `.foreman/review.json` holds the model's comments; it is git-ignored by `init`.

How "this machine only" is enforced:

- The endpoint must be `localhost`, `127.0.0.1` or `[::1]`; anything else is rejected.
- Redirects are never followed, so a local service cannot pass the prompt on to another machine.
- Ollama serves some models from its own servers through the local endpoint. Their names end in `cloud` (for example `qwen3-coder:480b-cloud`), and those names are refused, in the config and in `--model`. This check goes by the name only: a cloud model published under a name that does not end in `cloud` would not be caught, so use models you have pulled yourself.

## Projects you did not write

Foreman Solo is meant to be run on code handed to you, so the project itself is treated as untrusted:

- **Its git settings.** A project that arrives as a folder brings its own `.git/config`, and git runs programs named there. Every git command Foreman Solo runs switches off the file-system monitor and hooks; `git diff` also switches off external diff and text-conversion programs, does not enter submodules, and replaces every configured content filter with nothing. If a filter has a name that cannot be overridden safely, `review` stops instead of running `git diff`. This closes the settings known to run a program for the commands used; git has many settings, so it is not a guarantee about git itself.
- **Its `foreman.config.json`.** It can only point the LLM layer at this machine and at a local model (see above). It can still hide paths from the scan with `ignorePaths`; read it before trusting a clean result.
- **Its `.foreman/review.json`.** `review --reply` reads this file. It only ever opens source files inside the project, never a settings file such as `.env` and never a link.
- **Text from the model.** Code under review can contain instructions aimed at the model. The answer is validated, cut to length, and stripped of control and text-direction characters before it is saved or printed, so it cannot drive the terminal. It can still be wrong or misleading in what it says, which is why it is labelled machine-generated.

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

Read-only. Never executed, never modified (NFR-07). This includes programs named in the project's git settings (see "Projects you did not write").

## Reporting vulnerabilities in Foreman

Use GitHub private vulnerability reporting on the repo (enable it). Do not file public issues for security bugs.
