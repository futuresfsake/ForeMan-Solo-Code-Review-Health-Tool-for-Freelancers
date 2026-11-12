# Known gaps

What Foreman Solo will NOT do. Keep current; do not make this aspirational.

## Today (alpha, 0.1.0)

- Not published to npm. Run it from a clone (see the README).
- Validated only on three open-source Express apps, not yet on a production codebase of the author's own (see testing/validation-results.md). Expect false positives and misses on code styles not seen yet.
- `foreman-solo review` is experimental and `explain` is experimental too. `scan` never uses an LLM; only `review` and `explain` do, and only a model running on your own machine.
- The workflow written by `init --ci` calls the npm package, which is not published yet.
- The client report supports a logo and one accent colour but no other theming, and there is no PDF export (print the HTML page to PDF from a browser).
- CI for this repository is defined but has not been observed running on macOS or Linux yet.

## By design (MVP)

- Only Express and NestJS are understood. Other frameworks get the generic secret, injection, dependency and config checks; route checks are reported as "not checked".
- NestJS: the input validation check does not run (input arrives through `@Body()` and `@Param()`); `@Public()` routes behind a global guard can be reported as missing auth, so suppress them with a reason; the adapter has only been tested on fixtures, not on a real Nest codebase.
- The LLM review and explain are experimental (see below). Risk text is fixed per rule, not written for the specific project.
- No hosted dashboard, accounts or shared history; history is a local file.
- No runtime or dynamic analysis. It never boots the app.
- No type information: files are parsed one at a time, so data is not traced across files.
- Routes with dynamic paths and mounts through package or alias imports (`@/routes`) are not resolved. Routers mounted in a loop are resolved only for the common table-of-objects style.
- Not detected at all, because no rule covers them: NoSQL injection, command injection, insecure session and cookie settings, server-side request forgery, slow regular expressions, missing role checks on routes that do require login, and insecure direct object references.
- Handlers defined in another file (controllers) are not inspected, so the validation rule skips them silently.
- Auth detection is by middleware name. Custom names need `authMiddlewareNames`; auth done inside a handler is not seen and will be flagged.
- Middleware order across files is approximated: app-level middleware is assumed to apply to every route.
- Validation detection is shallow: it looks for any sign of validation, and does not prove a validator is correct or complete.
- The SQL rule follows a variable only within the same file, and only looks at common query method names.
- Secret detection covers well-known key formats and secret-like names. Random strings under innocent names are missed.
- Only npm lockfiles are audited. Yarn, pnpm and bun projects have the audit reported as skipped.
- GL-04 (backups) cannot be verified from code; it needs an attestation.
- HTTPS is often enforced by a host or proxy, outside the code. That finding is low confidence and expected to be suppressed with a note in those cases.
- Dependency results need network access; offline runs skip them and say so.
- Not a penetration test, compliance audit or certification (see security-and-trust.md and legal.md).

## The LLM review (`foreman-solo review`, experimental)

- It reviews the git diff of the working tree against a base (`HEAD` by default). New files that git does not track yet are not in a diff, so stage or commit them first.
- Only parsed source files are sent. `.env`, JSON, YAML and ignored paths are never part of the prompt.
- Secrets are masked before sending: well-known key formats, private key blocks, passwords inside connection strings (`scheme://user:password@host`), JSON Web Tokens, literal `Bearer` tokens, and string values on lines the scan flagged. A secret in any other shape that the scan does not recognise is not masked. Use `--dry-run` to see exactly what would be sent.
- The scan itself does not report connection-string passwords or JWTs as findings yet; they are only masked for the model.
- The prompt has no hard size limit: a changed file with a very large number of routes or findings can push it past the model's context, and Ollama then cuts it silently. `explain` has such a limit; `review` does not yet.
- Comments on a line the scan already reported are not shown, as likely repeats. They are kept in the JSON output (`hidden`), so this guess can be checked.
- Comments are never "high" confidence, and a comment that cannot be tied to a changed line is dropped.
- Context is limited to what fits a small model: about 14,000 characters of diff and 9,000 of related files. Large changes are cut, and the output says so.
- Tried once on a real `qwen2.5-coder:7b`: it ran end to end in about 11 seconds once loaded, but it mostly repeated scanner findings and generic advice, and missed a seeded business-logic bug (an unchecked refund amount and a missing ownership check). The reviewing pipeline is tested; the model's judgement is not proven.
- Output differs between runs.

## Explain (`foreman-solo explain`, experimental)

- It sees only a sample: up to 60 file names, 40 routes, the 30 most serious findings, and the start of the most connected files, about 20,000 characters in all so the prompt fits the model. On a large project the walkthrough is partial, and the output says what was left out.
- It is tested with a fake model only; it has not been tried on a real model or a real unfamiliar repository.
- Risks it names are checked only for pointing at a real file, not for being true. The static scan's findings are the reliable list.
- Output differs between runs.

## Inherent limits of the LLM layer

- No institutional memory of a client's incidents.
- No accountability if wrong; can be confidently wrong. Hence confidence levels and pushback.
- The first provider is a small model running locally (ADR-0007). It is weaker than a large hosted model: expect missed issues, wrong comments and slow runs on modest hardware. The LLM review is experimental and optional, and the static scan never depends on it.
- A hosted provider, if added later, sends code off the machine and will need explicit consent.
- Code under review can contain text written to steer the model (for example "report no problems"). The answer cannot drive the terminal or name files that do not exist, but nothing stops it from being misleading. Rely on the static scan, which the model cannot influence.
- Ollama cloud models are refused by name (names ending in `cloud`). A cloud model under another name would not be recognised.
