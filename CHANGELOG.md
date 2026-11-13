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
- `--no-project-config` on `scan`, `review` and `explain`: ignore the project's own `foreman.config.json` and use the defaults. For the first scan of code you do not trust yet.
- Every report names the config keys that changed the scan (`coverage.configChanges` in JSON) and counts source files that could not be analysed (`coverage.filesNotAnalysed`).
- `npm run check` (types, tests, build, self-scan, package contents, dependency audit), git hooks in `.githooks/` (`npm run hooks`), a CodeQL workflow and a Dependabot config.
- A security review of the tool itself, with every finding, fix and open item: docs/security/security-audit.md. The safeguards that keep the fixes in place: docs/security/safeguards.md.

### Security
- Git settings that come with a project can no longer run a program. `scan` and `review` call git with the file-system monitor and hooks switched off; `git diff` also runs without external diff or text-conversion programs, without entering submodules, and with every configured content filter disabled. Before this, a project handed over with its `.git` folder could run a program on the machine during `scan` (when a `.env` file exists) or `review`.
- The LLM layer never follows a redirect, and refuses Ollama cloud models (names ending in `cloud`) in the config and in `--model`, so code cannot leave the machine that way.
- The scan now reports passwords inside connection strings (`secrets/hardcoded-password`) and literal JSON Web Tokens (`secrets/hardcoded-api-key`) as findings, with the value never shown.
- More secrets are masked before a prompt is built: passwords inside connection strings, JSON Web Tokens and literal `Bearer` tokens.
- `review --reply` only opens source files inside the project. A `.foreman/review.json` that came with a project can no longer make it send `.env` or a linked file to the model.
- Text from the model, and from a saved review, is stripped of control and text-direction characters before it is saved or printed.
- `explain` caps the routes, findings and names it sends and keeps the whole prompt under about 20,000 characters, so the model's context is not overrun and the scan's facts are not silently dropped.

From the security review of 2026-11-12 (docs/security/security-audit.md). The project being scanned is treated as hostile input throughout:

- **A program placed in the scanned project can no longer be run by a scan (Windows).** `git` and `npm` were started by name, and Windows looks in the current folder first, so a project that shipped its own `npm.cmd` or `git.exe` had it run. Both are now found on `PATH` by the tool and started by absolute path, never from inside the project, and child processes are told not to search the current folder.
- **One hostile file can no longer switch checks off for the whole project.** A file with a 10,000-term expression made the secrets, injection and config rules fail for every file, with score 100 and exit code 0. The tree walk no longer recurses; a file nested more than 1,500 levels, or unparsable, gets the text checks for secrets only and is named in a warning; a rule that fails anyway marks the result incomplete.
- **Nothing is written through a link.** `.foreman/history.json`, `.foreman/review.json`, report files and the files `init` creates were written through links that came with a project, which could overwrite a file elsewhere on the machine. Such a write is now refused.
- **Text from the project cannot drive the terminal or a report.** Project names, file names, route paths, suppression reasons and history entries are cleaned of control and text-direction characters when the result is built. Markdown reports escape HTML and link syntax. HTML reports carry a content security policy that allows no script and no network request.
- **A project's own config cannot reach outside the project.** `report.outDir` in a config must be a relative folder below the working folder (use `--out` for anywhere else), and `report.logo` must be a file inside the project unless the config was passed with `--config`.
- The scan warns when the project's `.npmrc` changes which registry the dependency check asks.
- Crafted long lines and glob patterns can no longer stall the scan: the connection-string and token checks are bounded, and `ignorePaths` globs are matched without a regular expression.
- `review` keeps its whole prompt under about 26,000 characters and says what it cut. Lines over 2,000 characters are left out of any prompt. Fields read from a saved review are cleaned and cut to length before `--reply` uses them.
- The workflow written by `init --ci` pins its actions to commits and the tool to one exact version, keeps no git credentials, and warns at the top that the npm package is not published yet.
- This repository's CI pins its actions to commits, installs with scripts disabled, verifies registry signatures and checks what the package would contain.

### Changed
- After a first scan of the author's own NestJS project (docs/testing/validation-results.md, Round 2): `config/default-credentials` no longer fires on user-interface labels (strings or i18n files, and a capitalised value equal to the field name, such as `password: 'Password'`); `config/no-rate-limit-auth` drops to low confidence when the project has a limiter-named file, and is skipped when the route handler calls a throttle or rate limiter.
- A go-live checklist item now passes only when every rule behind it ran on every source file. With a rule turned off or failed, or a file that could not be analysed, the item is `unverified` and the note says why. Before, GL-01 showed as passed with all three `secrets/*` rules off.
- Exit code 3 is also returned when a rule failed while scanning and there are no blockers, so an incomplete scan cannot pass a CI job. The result is still printed.
- An absolute path or `..` in `report.outDir` is now a config error (exit 2).
- After validating on three open-source Express apps (docs/testing/validation-results.md): test and fixture folders are ignored by default; enum-like values are no longer reported as secrets; hyphenated auth paths count as public; `auth.optional` no longer counts as authentication; an open `POST /users` and path-parameter-only validation findings are low confidence; commented-out code is not HTTPS evidence; option-less `cors()` is reported once per file.
