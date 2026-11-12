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
- `foreman-solo init` (starter config, git-ignore entries) and `init --ci` (GitHub Actions workflow that scans on push and weekly).
- Plain-English business risk on every finding, and `--report client` for a non-technical summary with "prepared by" and client name.
- Rule `injection/code-eval`: `eval` or `new Function` on a dynamic value.
- Express adapter: chained `Router().use()` calls, routers mounted on routers in the same file, and routers mounted from a table of `{ path, route }` objects.
- NestJS adapter: controller routes with global and controller prefixes, guards, pipes and interceptors, and `APP_GUARD` style global providers. The input validation check does not run on Nest routes.
- Client report branding: `report.logo` (png, jpg, gif, webp or svg, up to 256 KB, embedded in the file) and `report.accentColor` in the config.
- Experimental `foreman-solo review`: a local model (Ollama, `localhost` only) reviews the current git diff with the scan's findings as facts. Comments carry a severity and a confidence (never "high"), secrets are masked before sending, `--dry-run` shows what would be sent, and `--reply` lets you push back on a comment. Config: `llm.model`, `llm.endpoint`.
- Experimental `foreman-solo explain`: the same local model gives a plain-language walkthrough of an unfamiliar project: what it is, its main areas, risky patterns and what to check before starting. The framework, routes and scan findings are given as facts with a sample of the most connected files; secrets are masked, `--dry-run` shows what would be sent, and nothing is written into the project. Anything that does not point at a real file is dropped.
- CI workflow for this repository (lint, test, build, smoke scan on three operating systems).

### Security
- Git settings that come with a project can no longer run a program. `scan` and `review` call git with the file-system monitor and hooks switched off; `git diff` also runs without external diff or text-conversion programs, without entering submodules, and with every configured content filter disabled. Before this, a project handed over with its `.git` folder could run a program on the machine during `scan` (when a `.env` file exists) or `review`.
- The LLM layer never follows a redirect, and refuses Ollama cloud models (names ending in `cloud`) in the config and in `--model`, so code cannot leave the machine that way.
- More secrets are masked before a prompt is built: passwords inside connection strings, JSON Web Tokens and literal `Bearer` tokens.
- `review --reply` only opens source files inside the project. A `.foreman/review.json` that came with a project can no longer make it send `.env` or a linked file to the model.
- Text from the model, and from a saved review, is stripped of control and text-direction characters before it is saved or printed.
- `explain` caps the routes, findings and names it sends and keeps the whole prompt under about 20,000 characters, so the model's context is not overrun and the scan's facts are not silently dropped.

### Changed
- After validating on three open-source Express apps (docs/testing/validation-results.md): test and fixture folders are ignored by default; enum-like values are no longer reported as secrets; hyphenated auth paths count as public; `auth.optional` no longer counts as authentication; an open `POST /users` and path-parameter-only validation findings are low confidence; commented-out code is not HTTPS evidence; option-less `cors()` is reported once per file.
