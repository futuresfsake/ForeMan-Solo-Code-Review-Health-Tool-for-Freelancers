# Release process

## Versioning (SemVer)

- Pre-1.0: minor may break contracts, but must be noted in the CHANGELOG.
- From 1.0: breaking a contract = major. Contracts: rule IDs, checklist IDs, JSON `schemaVersion`, CLI flags, exit codes, config keys.
- Adding a rule: minor. Changing a rule's default severity: minor and called out (it moves scores). Fixing a false positive: patch.
- Score formula changes: minor, with a CHANGELOG note, since trends shift.

## Before the first release

The npm name `foreman-solo` is not registered. Until it is, anyone can register it, and the README and the workflow written by `init --ci` would then run their code. Registering the name is the first release task, ahead of any feature.

1. Create or sign in to the npm account that will own the package and turn on two-factor authentication for sign-in and for publishing.
2. Publish the current alpha (see the checklist below). A `0.1.0` alpha is enough to hold the name.
3. On npmjs.com, set the package to require two-factor authentication or a trusted publisher for every publish, and disallow tokens that bypass it.

## Checklist

1. All milestone exit criteria for the release met.
2. `npm run check` green locally, and CI green on all three operating systems.
3. Reference-project validation re-run; results logged (NFR-06).
4. Security review re-run: `npx vitest run tests/security.test.ts`, `npm audit signatures`, and a read of every change that starts a program, writes a file or prints project text ([security/security-audit.md](security/security-audit.md#how-to-re-run-this-review)). Open findings listed in known-gaps.md.
5. Secret scan of the repository (`gitleaks dir --redact .`) and a look at the package contents (`npm run check:pack`; it fails on any file outside `dist/`, README, LICENSE and `package.json`).
6. Docs updated: lld.md, configuration.md, known-gaps.md.
7. CHANGELOG moved from Unreleased to the version.
8. Tag `vX.Y.Z` on a commit that is on `main` and has passed CI.
9. Publish (below), then GitHub release notes.

## Publishing

Preferred: publish from GitHub Actions with npm trusted publishing, so no long-lived npm token exists and each version carries a provenance record that links it to the commit and workflow that built it.

1. On npmjs.com, add this repository and a `release.yml` workflow as a trusted publisher for the package.
2. The workflow runs on a `v*` tag, with `permissions: { contents: read, id-token: write }`, actions pinned to commits, `npm ci --ignore-scripts`, `npm run check`, then `npm publish --provenance --access public`.
3. After publishing, check the package page shows the provenance badge and links back to this repository.

The release workflow is not written yet; it is added with the first release so that it is tested by a real publish, not committed unproven.

Fallback, for the very first publish only: from a clean checkout of the tagged commit, `npm ci --ignore-scripts`, `npm run check`, `npm publish --access public`, with two-factor authentication. `prepublishOnly` runs the full check and stops the publish if it fails.

Never publish from a working folder with uncommitted changes, and never with `--ignore-scripts` on `npm publish` itself (that would skip the check).

## After a release

- If a vulnerability is fixed: patch release, a `### Security` entry in the CHANGELOG, and a GitHub security advisory.

## Deprecation policy

- Deprecate with a warning for at least one minor release before removal.
- Renamed rule IDs keep an alias for at least two minors; the alias prints a warning.
- Removals only in a major.
