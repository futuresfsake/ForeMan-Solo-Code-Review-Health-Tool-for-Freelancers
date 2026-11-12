# Security review, 2026-11-12

A review of Foreman Solo itself: the CLI, its reports, its optional LLM layer, and the repository it is built and released from. It lists what was found, how each finding was confirmed, what was changed, and what is still open.

This is a self-review by the author, not an independent audit. It lowers risk; it does not prove the tool is free of defects. The standing description of how the tool treats data and untrusted projects is [security-and-trust.md](../security-and-trust.md); the tools that keep these fixes in place are in [safeguards.md](safeguards.md).

- Reviewed: commit `deae4b9` (0.1.0, unreleased), all of `src/`, the CI workflow, the repository settings on GitHub and the npm registry entry.
- Platform used: Windows 11, Node 22.14, git 2.50, npm 10.9.
- Result: 9 weaknesses in the code, all fixed in the same change, each with a regression test in [`tests/security.test.ts`](../../tests/security.test.ts). 9 weaknesses in the repository and release setup: 5 fixed, 4 need an action only the repository owner can take (listed under [Open actions](#open-actions-for-the-repository-owner)).

## Who the attacker is

Foreman Solo is run on code that was handed over: an inherited client project, a contractor's repository, a zip file. So the project being scanned is the attacker's input, all of it: source files, `package.json`, `foreman.config.json`, `.npmrc`, `.git/config`, `.foreman/`, file names, and any link or program placed in the folder.

That author wants one of three things:

1. **To run code on the reviewer's machine or CI runner.** A scanner is run early, with the reviewer's own account, before anyone has read the code.
2. **To look clean.** Hide a real problem, or make a broken scan look like a passed one, so the reviewer signs off.
3. **To get something out.** Have the tool copy data from the reviewer's machine into a report that is then sent to the client.

Every finding below is one of these three.

## Summary

| ID | Severity | Weakness | Goal | Status |
|---|---|---|---|---|
| F-01 | Critical (Windows) | A program placed in the scanned project was run by the scan | 1 | Fixed |
| F-02 | High | One hostile file switched off whole rule groups for the entire project, with exit code 0 | 2 | Fixed |
| F-03 | Medium | A go-live item showed "pass" when the rules behind it had not run | 2 | Fixed |
| F-04 | High | History, review and report files were written through links that came with the project | 1, 3 | Fixed |
| F-05 | Medium | Text from the project reached the terminal and the Markdown report unescaped | 2 | Fixed |
| F-06 | Medium | The project's own config could write reports anywhere, embed outside pictures and narrow the scan without the output saying so | 2, 3 | Fixed |
| F-07 | Low | Crafted long lines and config patterns stalled the scan | 2 | Fixed |
| F-08 | Low | The `review` prompt had no hard size limit | 2 | Fixed |
| F-09 | Low | HTML reports had no content security policy | 2 | Fixed |
| S-01 | High | The npm name `foreman-solo` is unregistered while the README and generated workflows run it | 1 | **Open: owner** |
| S-02 | Medium | CI used actions pinned by tag, kept git credentials on disk, and had no time limit | 1 | Fixed |
| S-03 | Medium | SECURITY.md points to private vulnerability reporting, which is switched off | n/a | **Open: owner** |
| S-04 | Medium | `main` is unprotected: no required checks, force-push allowed | 1 | **Open: owner** |
| S-05 | Low | No dependency alerts and no automated dependency updates | 1 | Config added; alerts **open: owner** |
| S-06 | Low | No code scanning on the repository | n/a | Fixed (CodeQL workflow added) |
| S-07 | Low | CI failed at random on Windows; the oldest supported Node is past end of life | n/a | Timeout fixed; Node floor is a decision |
| S-08 | Low | `dist/` was never cleaned, so a stale file could be published | 1 | Fixed |
| S-09 | Low | Two test fixtures held secret-shaped strings | n/a | Fixed |

Severity is judged for this tool's use: Critical means code runs on the reviewer's machine with no action beyond scanning; High means a scan result can be made wrong or a file outside the project changed; Medium needs a further step or misleads without hiding everything; Low costs time or is defence in depth.

## Findings in the code

### F-01 A program placed in the scanned project was run by the scan (Critical on Windows)

**What.** The tool started `git` and `npm` by bare name. Windows looks for a bare name in the current folder before it looks at `PATH`. `npm audit` runs with the project as its current folder, and `git` is started while the user's shell is in the project (the default way to run `foreman-solo scan`). A project containing `npm.cmd` or `git.exe` therefore had that file run.

**Confirmed.** A harmless `npm.cmd` that writes a marker file was placed in a test project; after `runNpmAudit` the marker existed. A stand-in `git.exe` in the project folder ran in place of the real git. Both only when the variable `NoDefaultCurrentDirectoryInExePath` is unset, which is the normal state of a Windows shell.

**Fix.** [`src/exec.ts`](../../src/exec.ts). Programs are found by walking `PATH` in the tool itself and are started by absolute path. Entries that are empty, relative, or inside the project being scanned are skipped. Every child process gets `NoDefaultCurrentDirectoryInExePath=1`, so a child that starts another program by name (as `npm.cmd` does with `node`) does not look in the project either. `npm.cmd` is started through the command interpreter by its absolute, quoted path; a path with characters that are unsafe to quote makes the dependency check skip with a reason instead of running.

**Not affected:** macOS and Linux, unless `PATH` itself contains `.` or an empty entry. The fix covers that case too.

### F-02 One hostile file switched off whole rule groups (High)

**What.** Rules walked each file's syntax tree by recursion. An expression with 10,000 terms (`1+1+1+...`, about 20 KB) is a tree 10,000 levels deep, and the walk ran out of stack. The error was caught per rule group, and the group was skipped for every file in the project.

**Confirmed.** With that one file added, a real AWS-format key in another file was no longer reported, the secrets, injection and config groups were all skipped, the score was 100 and the exit code was 0. A CI job would have passed.

**Fix.** Three layers:

- [`src/ast.ts`](../../src/ast.ts): the walk keeps its own stack and no longer recurses. A 100,000-term file now scans in 0.2 seconds with all rules running.
- [`src/loader.ts`](../../src/loader.ts): a file nested more than 1,500 levels, or one the parser cannot read, is not handed to the rules as code. The text checks for secrets still run on it, a warning names it, and `coverage.filesNotAnalysed` counts it. Code-based checklist items become `unverified`.
- [`src/scan.ts`](../../src/scan.ts), [`src/cli.ts`](../../src/cli.ts): if a rule group fails anyway, the result says it is incomplete and the process exits with code 3, never 0.

### F-03 A go-live item passed when its rules had not run (Medium)

**What.** GL-01 ("Secrets removed from repo") depends on four rules. It was shown as passed if any one of them ran. Turning the three `secrets/*` rules off in a config, or having them crash (F-02), still gave a tick.

**Fix.** [`src/score.ts`](../../src/score.ts): an item passes only when every rule behind it ran. Otherwise it is `unverified` and the note names the rules that did not run. An attestation still turns `unverified` into `pass`, and is shown.

### F-04 Files were written through links that came with the project (High)

**What.** `.foreman/history.json`, `.foreman/review.json`, the `foreman-report/` folder and the files `init` writes were written with plain file calls, which follow links. A project that ships `.foreman` or `foreman-report` as a link to another folder, or `history.json` as a link to a file, had the tool write there: any file the user can write could be overwritten by a scan.

**Confirmed.** With `.foreman` linked to an outside folder, `history.json` appeared in that folder after a default scan. With `foreman-report` linked, `report.html` did.

**Fix.** [`src/fsafe.ts`](../../src/fsafe.ts). Every write goes through `writeInside`, which refuses a target outside its base folder and refuses when any existing part of the path is a link. On macOS and Linux the file is also opened with `O_NOFOLLOW`. A refused history write is a warning; a refused report write is an error with exit code 2.

### F-05 Text from the project reached the terminal and reports unescaped (Medium)

**What.** The project name (from `package.json`), file names, route paths, variable names, suppression reasons and the timestamps in `.foreman/history.json` were printed as they were. Terminal escape sequences in them could clear the screen or overwrite lines, which is enough to hide findings from someone reading the output. The Markdown report passed raw HTML and link syntax through.

**Fix.** [`src/text.ts`](../../src/text.ts) (moved out of the LLM layer, where it already protected model output). `scanProject` cleans every project-controlled string once, when the result is built, so the terminal, JSON, HTML and Markdown outputs all receive clean text. Markdown cells escape HTML and link syntax. History entries are accepted only if they are exactly a timestamp and a score. Error messages, which can quote git's output or config values, are cleaned before printing.

### F-06 The project's own config had too much reach (Medium)

`foreman.config.json` arrives with the project, so it is the attacker's file. Four problems:

| Problem | Fix |
|---|---|
| `report.outDir` could name any folder on the machine, and `report.html` was written there | The config may only name a folder below the working folder. `--out` on the command line is unrestricted, because the user typed it |
| `report.logo` could name any picture on the machine (up to 256 KB), which was embedded in the client report, a file made to be sent to someone else | The logo must be a real file inside the project. A config passed with `--config` is the user's own and may point elsewhere |
| `ignorePaths`, `weights`, `sensitiveRoutes` and `authMiddlewareNames` could hide findings with nothing in the output saying the scan had been narrowed. Zero weights gave a score of 100 with open blockers | Every output now names the config keys that differ from the defaults (`coverage.configChanges`). New flag `--no-project-config` scans with the defaults |
| `npm audit` obeys the project's `.npmrc`, which can send the check to another server that answers "no problems" | npm cannot be told to ignore the file without breaking legitimate setups, so the scan warns when `.npmrc` sets a registry, proxy, TLS or audit option |

### F-07 Crafted input stalled the scan (Low)

**What.** Several patterns took time in proportion to the square of the line length. A 250 KB line cost 7 seconds; a 1 MB file, minutes. Affected: the connection-string and token checks (added the same day), the placeholder check, the inline suppression pattern, the import pattern in the LLM layer, and secret masking before a prompt. Separately, a glob in `ignorePaths` such as `*a*a*a*a*a*b` stalled the path matcher.

**Fix.** The connection-string and token checks in [`src/rules/secrets.ts`](../../src/rules/secrets.ts) are bounded walks that look at each character a fixed number of times; the same line now takes 10 ms. Suppression comments are only read on lines up to 2,000 characters. Lines longer than that are left out of an LLM prompt whole. [`src/glob.ts`](../../src/glob.ts) no longer builds a regular expression: it steps through the text once per pattern element, and a test checks it against the old matcher on 100,000 random cases.

### F-08 The `review` prompt had no hard size limit (Low)

Listed as a known gap before this review. A change with hundreds of routes or findings pushed the prompt past the model's context, and Ollama cuts an oversized prompt silently, possibly dropping the scan's facts or the question. [`src/llm/review.ts`](../../src/llm/review.ts) now caps the findings and routes it sends, then drops related files, then shortens the changed code, until the prompt is under 26,000 characters, and says what it cut. Fields read from a saved `.foreman/review.json` are cleaned and cut to length before `--reply` puts them in a prompt.

### F-09 HTML reports had no content security policy (Low)

Escaping in the HTML reports was reviewed and found complete. As a second layer, each report now carries a policy that allows only its own inline styles and an embedded logo: no script, no network request, no form. If an escaping bug is ever introduced, the browser still runs nothing.

## Findings in the repository and release setup

### S-01 The npm name is unregistered (High, open)

`foreman-solo` does not exist on npm (checked 2026-11-12: 404). The README shows `npx foreman-solo scan`, and `init --ci` writes a workflow that runs `npx --yes foreman-solo`. Until the name is registered by this project, anyone can register it, and their code would run on the machines and CI runners of everyone who follows either instruction.

Done in this change: the generated workflow now carries a warning at the top, pins one exact version and pins its actions to commits; the README leads with the clone instructions and states the risk. Neither removes the risk. **Only publishing the name does.** See [Open actions](#open-actions-for-the-repository-owner).

### S-02 CI pipeline hardening (Medium, fixed)

`actions/checkout@v4` style references follow a tag, and a tag can be moved to different code. The workflow also left the job's git credentials on disk and had no time limit. Now: every action is pinned to a commit with the version in a comment, `persist-credentials: false`, `npm ci --ignore-scripts`, a time limit per job, and one run per branch at a time. The token was already read-only.

### S-03 Private vulnerability reporting is off (Medium, open)

SECURITY.md tells reporters to use GitHub's private reporting. The setting is disabled on the repository, so the button it describes does not exist and the only channel left is a public issue.

### S-04 `main` is unprotected (Medium, open)

No branch protection and no ruleset: a force-push can rewrite history, and a failing check does not stop anything. For a tool people will install, the release branch should at least refuse force-pushes and deletion.

### S-05 Dependency alerts and updates (Low, part open)

Dependabot alerts are off. [`.github/dependabot.yml`](../../.github/dependabot.yml) now asks for weekly update pull requests for npm packages and for the pinned actions. Alerts and security updates are repository settings and still need switching on.

### S-06 Code scanning (Low, fixed)

[`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml) runs GitHub's CodeQL with the extended security queries on every push and pull request to `main` and weekly. It is free for public repositories. It has not run yet; it will on the first push that includes it.

### S-07 CI reliability and the Node floor (Low)

The last CI run before this review failed on Windows with Node 20: a test that creates a git repository took 6.5 seconds against a 5 second limit. [`vitest.config.ts`](../../vitest.config.ts) raises the limit to 30 seconds. Separately, Node 20 reached end of life in April 2026 and no longer receives security fixes; the test runner already cannot print a failure on it. CI now also runs Node 24. Raising the documented minimum from Node 20 to 22 is a contract change and is left as a decision.

### S-08 Stale files in the package (Low, fixed)

`npm run build` did not empty `dist/` first, so a file from an older build (or one edited by hand while debugging) would have been published. The build now cleans first, and `npm run check:pack` fails if the package would contain anything other than `dist/`, the README, the licence and `package.json`. `prepublishOnly` runs the full check.

### S-09 Secret-shaped strings in test fixtures (Low, fixed)

gitleaks 8.30 reported three matches in the git history, all in test fixtures: a made-up database password (twice) and the public header bytes of a private-key file. None is a real credential, so the history was not rewritten. The two that were still in the working tree are now assembled at runtime, as the testing strategy already required; the working tree scans clean.

## Checked and found sound

- HTML reports escape every value from the project. The logo is shown through an `<img>` tag, where a browser runs no script, even from an SVG.
- The LLM layer accepts only `localhost`, `127.0.0.1` or `[::1]`, never follows a redirect, and refuses Ollama cloud models by name.
- Git is called with the file-system monitor, hooks, external diff, text conversion and content filters switched off (the earlier hardening; see the CHANGELOG).
- The loader never follows a link, never reads a file over 1 MB, and never executes or imports project code.
- `.env` files are read only to check whether they are tracked; their contents are never printed, stored or sent.
- Secret values in findings show four characters and a length, never the value. Connection-string passwords and tokens show nothing.
- The config loader rejects unknown keys and wrong types.
- No telemetry, no update check, no network call other than `npm audit` and the opt-in local model.
- `npm audit`: 0 known vulnerabilities in the dependency tree. `npm audit signatures`: 39 packages with verified registry signatures, 18 with verified provenance attestations.

## What is still open in the code

These are known and accepted for now. They are also in [known-gaps.md](../gaps/known-gaps.md).

- **A project can still keep code away from the rules, visibly.** A file over 1 MB, a file nested past the limit, a folder named in `ignorePaths`, or an inline `foreman-ignore` comment each take code out of the checks. The output says so every time (a warning, the config notice, the suppressed count), and affected checklist items become unverified, but the reviewer has to read the output.
- **`.npmrc` is obeyed by npm.** The scan warns; it does not prevent.
- **The link check and the write are two steps.** A process changing the folder at the same moment could slip between them on Windows. The threat here is a folder that was prepared in advance, not a program running alongside the scan.
- **No overall time budget.** The patterns that run over whole lines were reviewed and tested with hostile input, which is not a proof for every pattern in every rule. The TypeScript parser's own speed on hostile input is bounded only by the 1 MB file limit.
- **npm and git are trusted programs.** The tool controls how they are found and what settings they obey. It does not defend against a defect in npm or git themselves.
- **The model can be steered by the code it reads.** Unchanged from before: it cannot drive the terminal or name files that do not exist, but it can be made to say something misleading.
- **Not done:** fuzzing, a source review of the two runtime dependencies (`commander`, `typescript`), and a review by anyone other than the author. Semgrep was not run: it is not installed on the machine used and the Docker service was not running.

## Open actions for the repository owner

None of these can be done from the code. In order of importance:

1. **Register the npm name (S-01).** Turn on two-factor authentication for the npm account, then from a clean checkout: `npm run check`, `npm publish --access public`. A first alpha release is enough to hold the name. Preferably publish from GitHub Actions with npm trusted publishing, so each release carries a provenance record ([release-process.md](../release-process.md)).
2. **Turn on private vulnerability reporting (S-03).** Repository Settings, Advanced Security, "Private vulnerability reporting". Or: `gh api -X PUT repos/OWNER/REPO/private-vulnerability-reporting`.
3. **Protect `main` (S-04).** Settings, Rules, new branch ruleset for `main`: block force pushes, block deletion, require the `test` and `supply-chain` checks. Requiring pull requests is optional for a single maintainer.
4. **Turn on Dependabot alerts and security updates (S-05).** Settings, Advanced Security. Or: `gh api -X PUT repos/OWNER/REPO/vulnerability-alerts` and `gh api -X PUT repos/OWNER/REPO/automated-security-fixes`.
5. **Restrict which actions may run.** Settings, Actions, General: allow GitHub's own actions plus named ones, and require actions to be pinned to a commit.
6. **Decide the Node floor (S-07).** Keep Node 20 and accept an unsupported runtime, or move `engines`, the docs and CI to Node 22.
7. **Turn the hooks on in each clone:** `npm run hooks` (see [safeguards.md](safeguards.md)).

## How to re-run this review

```bash
npm run check                 # types, 144 tests, build, self-scan, package contents, dependency audit
npx vitest run tests/security.test.ts   # one test per finding above
npm audit signatures          # registry signatures and provenance
gitleaks dir --redact .       # secrets in the working tree (free, optional)
gitleaks git --redact .       # secrets in the git history
```

Repeat before each release, and whenever code that starts a program, writes a file, or prints project text is changed.
