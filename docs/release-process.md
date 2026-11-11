# Release process

## Versioning (SemVer)

- Pre-1.0: minor may break contracts, but must be noted in the CHANGELOG.
- From 1.0: breaking a contract = major. Contracts: rule IDs, checklist IDs, JSON `schemaVersion`, CLI flags, exit codes, config keys.
- Adding a rule: minor. Changing a rule's default severity: minor and called out (it moves scores). Fixing a false positive: patch.
- Score formula changes: minor, with a CHANGELOG note, since trends shift.

## Checklist

1. All milestone exit criteria for the release met.
2. `npm run lint && npm test` green on CI (3 OSes).
3. Reference-project validation re-run; results logged (NFR-06).
4. Secret scan of the repo and the packed tarball (`npm pack --dry-run`).
5. Docs updated: lld.md, configuration.md, known-gaps.md.
6. CHANGELOG moved from Unreleased to the version.
7. Tag `vX.Y.Z`, `npm publish`, GitHub release notes.

## Deprecation policy

- Deprecate with a warning for at least one minor release before removal.
- Renamed rule IDs keep an alias for at least two minors; the alias prints a warning.
- Removals only in a major.
