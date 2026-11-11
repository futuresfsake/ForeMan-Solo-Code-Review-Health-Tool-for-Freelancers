# Known gaps

What Foreman Solo will NOT do. Keep current; do not make this aspirational.

## Today (alpha, 0.1.0)

- Not published to npm. Run it from a clone (see the README).
- Not yet validated on a real production codebase (milestone M4 gate). Expect false positives and misses until that is done.
- `foreman-solo init`, `review` and `explain` do not exist yet.
- No continuous integration is set up for the repository itself.

## By design (MVP)

- Only Express is understood. Other frameworks get the generic secret, injection, dependency and config checks; route checks are reported as "not checked".
- No LLM review, narratives, explain mode, branding or PDF.
- No hosted dashboard, accounts or shared history; history is a local file.
- No runtime or dynamic analysis. It never boots the app.
- No type information: files are parsed one at a time, so data is not traced across files.
- Routes with dynamic paths, routers built in loops, and mounts through package or alias imports (`@/routes`) are not resolved.
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
