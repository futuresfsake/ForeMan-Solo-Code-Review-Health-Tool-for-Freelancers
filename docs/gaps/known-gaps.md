# Known gaps

What Foreman Solo will NOT do. Keep current; do not make this aspirational.

## Today (alpha, 0.1.0)

- Not published to npm. Run it from a clone (see the README).
- Validated only on three open-source Express apps, not yet on a production codebase of the author's own (see testing/validation-results.md). Expect false positives and misses on code styles not seen yet.
- `foreman-solo review` and `explain` do not exist yet. Nothing in the tool uses an LLM.
- The workflow written by `init --ci` calls the npm package, which is not published yet.
- The client report has names but no logo or colour branding, and there is no PDF export (print the HTML page to PDF from a browser).
- CI for this repository is defined but has not been observed running on macOS or Linux yet.

## By design (MVP)

- Only Express and NestJS are understood. Other frameworks get the generic secret, injection, dependency and config checks; route checks are reported as "not checked".
- NestJS: the input validation check does not run (input arrives through `@Body()` and `@Param()`); `@Public()` routes behind a global guard can be reported as missing auth, so suppress them with a reason; the adapter has only been tested on fixtures, not on a real Nest codebase.
- No LLM review or explain mode. Risk text is fixed per rule, not written for the specific project.
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

## Inherent limits of the LLM layer (post-MVP)

- No institutional memory of a client's incidents.
- No accountability if wrong; can be confidently wrong. Hence confidence levels and pushback.
