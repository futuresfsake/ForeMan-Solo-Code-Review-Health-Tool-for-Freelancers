# Security and trust

How Foreman Solo treats your data and the code you point it at. The findings of the last review of the tool itself are in [security/security-audit.md](security/security-audit.md); the tools that guard the repository are in [security/safeguards.md](security/safeguards.md).

## What data leaves the machine

| Feature | Data sent | To where |
|---|---|---|
| `scan` (static pass) | Nothing | n/a |
| `npm audit` | Package names/versions from the lockfile (npm's standard behaviour) | The npm registry, or the registry named in the project's `.npmrc` (the scan warns when it does) |
| Reports/history | Nothing; written to local disk | n/a |
| `foreman-solo review` (opt-in) | The git diff, related source files and the scan's findings, with secrets masked | A model on this machine through Ollama (`localhost` only). `scan` never does this |
| `foreman-solo explain` (opt-in) | Project name, script and dependency names, file names, routes, the scan's findings and the start of the most connected source files, with secrets masked | The same local model. `scan` never does this |

No telemetry, no accounts, no update pings. Before anything is put in an LLM prompt, detected secrets are masked, and `--dry-run` on `review` and `explain` prints exactly what would be sent without sending it. The masking is a safety net: a secret the scan cannot recognise is not masked. Lines longer than 2,000 characters (minified or generated code) are left out of a prompt whole. If a hosted provider is ever added, it must show what will be sent and ask for explicit consent first. `.foreman/review.json` holds the model's comments; it is git-ignored by `init`.

How "this machine only" is enforced:

- The endpoint must be `localhost`, `127.0.0.1` or `[::1]`; anything else is rejected.
- Redirects are never followed, so a local service cannot pass the prompt on to another machine.
- Ollama serves some models from its own servers through the local endpoint. Their names end in `cloud` (for example `qwen3-coder:480b-cloud`), and those names are refused, in the config and in `--model`. This check goes by the name only: a cloud model published under a name that does not end in `cloud` would not be caught, so use models you have pulled yourself.

## Projects you did not write

Foreman Solo is meant to be run on code handed to you, so the project itself is treated as untrusted: its files, its settings, and anything placed in its folder. The person who wrote it may want to run code on your machine, to look clean when they are not, or to get data out through a report.

- **Programs in its folder.** The tool starts two programs, `git` and `npm`. It finds them on `PATH` itself and starts them by absolute path, skipping any `PATH` entry that is relative, empty or inside the project. A `git.exe` or `npm.cmd` placed in the project is never run. Child processes are told not to search the current folder either.
- **Its git settings.** A project that arrives as a folder brings its own `.git/config`, and git runs programs named there. Every git command Foreman Solo runs switches off the file-system monitor and hooks; `git diff` also switches off external diff and text-conversion programs, does not enter submodules, and replaces every configured content filter with nothing. If a filter has a name that cannot be overridden safely, `review` stops instead of running `git diff`. This closes the settings known to run a program for the commands used; git has many settings, so it is not a guarantee about git itself.
- **Its `foreman.config.json`.** It can turn rules off, ignore folders, change the score weights and attest checklist items. Every report names the config keys that differ from the defaults, and `--no-project-config` scans with the defaults instead. It cannot send report files outside the folder you run the scan from, cannot embed a picture from outside the project in the client report, and can only point the LLM layer at this machine and at a local model.
- **Its `.npmrc`.** npm obeys it, so it can send the dependency check to another server. The scan cannot stop that; it warns when the file sets a registry, proxy, TLS or audit option.
- **Links in its folder.** The loader never follows a link. Nothing is written through one either: if `.foreman`, `foreman-report` or a file below them is a link, the write is refused, so a scan cannot be aimed at a file elsewhere on the machine.
- **Its `.foreman` files.** `history.json` is read as numbers and timestamps only; anything else in it is dropped. `review --reply` reads `review.json`: it only ever opens source files inside the project, never a settings file such as `.env` and never a link, and every field is cleaned and cut to length before it is used.
- **Names and text in its code.** The project name, file names, route paths and suppression reasons are cleaned of control and text-direction characters once, when the result is built, so they cannot clear the terminal, rewrite lines or hide what a report says. The Markdown and HTML reports escape them, and the HTML reports carry a content security policy that allows no script and no network request.
- **Files built to break the scanner.** A file over 1 MB is not read. A file nested more than 1,500 levels deep, or one that cannot be parsed, is not analysed as code: the text checks for secrets still run on it, a warning names it, and the checklist items that depend on the code become unverified. If a rule fails anyway, the result is marked incomplete and the exit code is 3, never 0.
- **Text from the model.** Code under review can contain instructions aimed at the model. The answer is validated, cut to length, and stripped of control and text-direction characters before it is saved or printed, so it cannot drive the terminal. It can still be wrong or misleading in what it says, which is why it is labelled machine-generated.

What this does not cover: a problem the project hides in a file the output tells you was skipped, ignored or suppressed. Read the warnings ([a short routine](security/safeguards.md#when-you-scan-code-you-did-not-write)).

## What Foreman stores

- `foreman-report/` output (may contain code snippets and file paths; treat as confidential client material).
- `.foreman/history.json`: timestamps, scores, counts only.
- `.foreman/review.json`: the last LLM review, if you ran one.

## What Foreman is NOT

- Not a security audit, penetration test or compliance certification.
- Not proof that code is secure. A high score means the checked rules found little, nothing more.
- Not a substitute for human review on high-risk systems.

See [legal.md](legal.md) for licence, disclaimer and trademark notes.

Reports state which checks ran, which were skipped, and which checklist items are unverified. The client-ready report must use wording like "review completed" and never "certified secure".

## Handling of scanned code

Read-only. Never executed, never modified (NFR-07). This includes programs named in the project's git settings and programs placed in the project folder (see "Projects you did not write"). The only files written are the reports, `.foreman/history.json`, `.foreman/review.json`, and what `init` creates when you ask for it.

## Reporting vulnerabilities in Foreman

See [SECURITY.md](../SECURITY.md). Do not file public issues for security bugs.
