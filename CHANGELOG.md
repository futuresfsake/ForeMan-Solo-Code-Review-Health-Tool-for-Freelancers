# Changelog

Format: [Keep a Changelog](https://keepachangelog.com). Versioning: [SemVer](https://semver.org) (see docs/release-process.md).

## [Unreleased]

### Added
- Project documentation set (overview, requirements, design, ADRs, roadmap, testing, security, legal notes).
- `foreman-solo scan`: static scan of a Node project with a terminal report, 0-100 health score and go-live checklist (GL-01 to GL-07).
- Express adapter: routes, router mounts across files, and route, router and app level middleware.
- Rules: hardcoded keys and passwords, committed env files, SQL string building, unvalidated request input, missing authentication on sensitive routes, development mode, missing HTTPS enforcement, permissive CORS, default credentials, stack-trace leaks, missing rate limiting on auth routes, vulnerable dependencies (npm audit), missing lockfile.
- Output: `--report html|md`, `--format json`, `--all` multi-project summary, local score history with trend.
- Suppressions with a mandatory reason (inline comment or config), rule overrides, checklist attestations.
- Exit codes for CI: 0 ok, 1 blockers or score under `--fail-under`, 2 usage/config error, 3 internal error.
