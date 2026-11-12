# Safeguards

The free tools and settings that protect Foreman Solo and the people who run it. Everything here costs nothing for a public repository. Why each exists is in the [security review](security-audit.md).

## One command

```bash
npm run check
```

Runs, in order: the type check, the test suite (including [`tests/security.test.ts`](../../tests/security.test.ts)), a clean build, a scan of this repository with the tool itself, a check of what `npm pack` would publish, and `npm audit` on the packages that ship. CI runs the same steps, and `npm publish` refuses to run without them (`prepublishOnly`).

## What is in place

| Safeguard | What it stops | Where | Status |
|---|---|---|---|
| Security regression tests | A fixed weakness coming back | `tests/security.test.ts`, `tests/hardening.test.ts` | On, in CI |
| Self-scan | A secret or risky pattern in this repository's own source | `npm run check`, CI smoke step | On, in CI |
| `npm audit` | A known vulnerability in `commander` or `typescript` | `supply-chain` job in `ci.yml` | On, in CI |
| `npm audit signatures` | A tampered or unsigned package in the install | `supply-chain` job in `ci.yml` | On, in CI |
| Package content check | A stray file (report, local config, fixture) reaching npm | `scripts/check-pack.mjs` | On, in CI and before publish |
| Install scripts off in CI | A dependency running code on the runner at install time | `npm ci --ignore-scripts` | On |
| Actions pinned to a commit | A moved tag changing what CI runs | every `uses:` in `.github/workflows/` | On |
| Read-only CI token, no stored credentials | A compromised step pushing to the repository | `permissions: contents: read`, `persist-credentials: false` | On |
| CodeQL code scanning | Injection, path and command-execution defects in `src/` | `.github/workflows/codeql.yml` | Added; first run on next push |
| Dependabot updates | Stale pins and unpatched dependencies | `.github/dependabot.yml` | Added; alerts need switching on |
| GitHub secret scanning and push protection | A real credential being pushed | Repository setting | On |
| Pre-commit hook | A secret-shaped value being committed | `.githooks/pre-commit` | Per clone: `npm run hooks` |
| Pre-push hook | Pushing code that fails the checks | `.githooks/pre-push` | Per clone: `npm run hooks` |

## Git hooks

```bash
npm run hooks        # once per clone: points git at .githooks/
```

- **pre-commit** looks only at what is staged, so it stays fast. With [gitleaks](https://github.com/gitleaks/gitleaks) installed it runs gitleaks on the staged changes; without it, it checks a short list of well-known key shapes.
- **pre-push** runs `npm run check`.

To undo: `git config --unset core.hooksPath`. To skip once, with a reason: `--no-verify`.

## Settings only the owner can change

These are not files, so they are not in the repository. Their current state and the exact steps are in the [review](security-audit.md#open-actions-for-the-repository-owner).

| Setting | State on 2026-11-12 |
|---|---|
| npm name `foreman-solo` registered, account with two-factor authentication | **Not registered** |
| Private vulnerability reporting | **Off** |
| Branch ruleset on `main` (no force-push, no deletion, required checks) | **None** |
| Dependabot alerts and security updates | **Off** |
| Actions limited to named actions, commit pinning required | Not restricted |
| Secret scanning and push protection | On |
| Default workflow token permission | Read-only |

## Optional, not set up

Free tools that would add coverage. None is required. gitleaks was run once, by hand, during the review; the others have not been run against this repository yet.

| Tool | What it adds | How to try it |
|---|---|---|
| [gitleaks](https://github.com/gitleaks/gitleaks) | Secret scanning of the working tree and the whole history | `gitleaks dir --redact .` and `gitleaks git --redact .` |
| [Semgrep Community Edition](https://semgrep.dev) | A second static analyser with Node and TypeScript rule packs | `semgrep scan --metrics=off --config p/typescript --config p/nodejs --config p/security-audit src` |
| [OpenSSF Scorecard](https://github.com/ossf/scorecard) | A scored checklist of repository practices (pinning, branch protection, review) | The `ossf/scorecard-action` workflow, pinned to a commit |
| [OSV-Scanner](https://github.com/google/osv-scanner) | A second source of advisories for the lockfile | `osv-scanner --lockfile=package-lock.json` |
| npm provenance | Proof of which commit and workflow built a published version | Publish from GitHub Actions with trusted publishing ([release-process.md](../release-process.md)) |

## When you scan code you did not write

The tool treats the project as untrusted, but the output still has to be read. A short routine:

1. Scan with `--no-project-config` first. The project's own `foreman.config.json` can turn rules off, ignore folders and change the score.
2. Read every line that starts with `Warning:` and the line that starts with `The config in effect changes the scan`. A file that was skipped or could not be analysed is where a problem would be hidden.
3. Treat `unverified` on the checklist as "not checked", not as "probably fine".
4. Look at the suppressed count. Open the HTML report to see each suppression and its reason.
5. If the project has an `.npmrc`, read it before trusting the dependency result.
6. Exit code 3 means the scan itself failed partway. Do not use that result.

## Reporting a problem

See [SECURITY.md](../../SECURITY.md).
