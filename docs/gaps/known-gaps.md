# Known gaps

What Foreman Solo will NOT do. Keep current; do not make this aspirational.

## Today (pre-MVP)

Nothing is implemented.

## By design (MVP)

- Only Express is understood. Other frameworks get generic secret/dep/config checks at best.
- No LLM review, narratives, explain mode, branding, PDF.
- No hosted dashboard, accounts or shared history; history is a local file.
- No runtime or dynamic analysis. It never boots the app.
- Dynamic route registration (computed paths, routes added by plugins at runtime) may be missed.
- Auth detection is heuristic: it matches middleware names from config and can miss custom auth or flag intentionally public routes.
- Validation detection is shallow: flags unvalidated use, does not prove a validator is correct.
- No taint analysis across files in MVP; SQL concat rule is local.
- GL-04 (backups) cannot be verified statically; needs attestation.
- HTTPS enforcement may be handled at proxy/host, outside the code; reported as should-fix with medium confidence.
- Dependency results depend on `npm audit` and need network; offline mode skips them and says so.
- Not a penetration test, compliance audit or certification (see security-and-trust.md).

## Inherent limits of the LLM layer (post-MVP)

- No institutional memory of a client's incidents.
- No accountability if wrong; can be confidently wrong. Hence confidence levels and pushback.
