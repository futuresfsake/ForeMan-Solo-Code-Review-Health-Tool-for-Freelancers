# ADR-0005: Product name Foreman Solo, npm package `foreman-solo`

- Status: Accepted (2026-11-11). The short `foreman` bin is dropped by ADR-0006; the names stand.

## Context

The project started under an earlier working title. Its npm name was already owned by an unrelated package, and several close variants were taken too. The author renamed it to **Foreman Solo**. On npm, `foreman` is also taken (an unrelated Node implementation of Foreman), while `foreman-solo` is free (checked 2026-11-11).

## Decision

- Product name: **Foreman Solo**. Repo: `ForeMan-Solo-Code-Review-Health-Tool-for-Freelancers`.
- npm package: `foreman-solo`. Invocation: `npx foreman-solo scan`.
- Installed bins: `foreman-solo` and the shorter `foreman`. Docs show `foreman ...` for installed use.
- The earlier working title is retired and should not appear in docs, code or package metadata.

## Consequences

- If a user also has the unrelated `foreman` package installed globally, the `foreman` bin can collide; `foreman-solo` always works. Reconsider the short bin if this causes reports.
- Re-verify `foreman-solo` is free right before the first publish. Fallback: `@<user>/foreman`.
- Not checked: GitHub or trademark conflicts for "Foreman" (the Foreman infrastructure tool is well known).
