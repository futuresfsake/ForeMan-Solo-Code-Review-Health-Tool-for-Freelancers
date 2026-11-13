# Validation results

Record of running Foreman Solo on real code and checking every finding by hand. This is the evidence for the M4 gate and for NFR-06.

## Round 1: open-source Express apps (2026-11-11)

The author had no Node project of their own to test on, so three public Express applications were used instead. They were shallow-cloned at their default branch on the date above and scanned with `--no-audit --no-history`. Nothing in them was run.

| Project | Why it was chosen |
|---|---|
| OWASP NodeGoat | A training app that is vulnerable on purpose, so true positives are known |
| node-express-boilerplate (hagopj13) | A widely copied, well-structured starter; should come out nearly clean |
| node-express-realworld-example-app (gothinkster) | TypeScript, chained routers, a typical small API |

Naming a project here is not a criticism of it. NodeGoat's problems are intentional, and the others are example code.

### Before fixes

| Project | Score | Findings | Judged wrong or misleading |
|---|---|---|---|
| NodeGoat | 64 | 9 | 1, and the `eval` on request data was missed entirely |
| node-express-boilerplate | 57 | 15 | 13 |
| realworld example | 48 | 22 | 2, and all paths lacked their `/api` prefix |

What went wrong, and what was changed:

| Problem found | Fix |
|---|---|
| Routers mounted from a table of `{ path, route }` objects in a loop were not resolved, so routes lost their prefix and their rate limiter | The adapter now reads such tables |
| Chained `Router().use(a).use(b)` and a router mounted on another router in the same file were not understood | The adapter now follows call chains and same-file mounts |
| An enum of token types (`RESET_PASSWORD: 'resetPassword'`) was reported as a hardcoded password | A value that is the same word as its name, or letters only, is no longer reported, except as the fallback for a secret environment variable |
| Test fixtures were reported for containing test passwords | `test`, `tests`, `fixtures`, `e2e`, `cypress` and `__mocks__` folders are ignored by default |
| `/forgot-password`, `/refresh-tokens`, `/verify-email`, `/logout` were reported as missing authentication | Public path matching now covers hyphenated names, and the default list is longer |
| `auth.optional` was counted as authentication | Names containing "optional" no longer count |
| An open `POST /users` (public sign-up) was reported as a blocker | Now should-fix, low confidence, with a note to suppress it if it is sign-up |
| Reading only a path parameter was reported as loudly as an unvalidated body | Path-parameter-only cases are now low confidence |
| Commented-out `helmet` lines counted as HTTPS evidence | Comments are stripped before looking for evidence |
| `cors()` used twice in a file was reported twice | Reported once per file |
| `eval(req.body.x)` was not detected | New rule `injection/code-eval` |

Each fix has a regression test in `tests/real-world-patterns.test.ts`.

### After fixes

| Project | Score | Findings | True | Arguable | Wrong |
|---|---|---|---|---|---|
| NodeGoat | 19 | 11 | 11 | 0 | 0 |
| node-express-boilerplate | 97 | 1 | 1 | 0 | 0 |
| realworld example | 55 | 22 | 13 | 9 | 0 |

- NodeGoat: `eval` on request data (3), seeded user passwords in a reset script (3), an API key in config files (2), no rate limit on login and sign-up (2), an unvalidated redirect parameter (1).
- Boilerplate: `cors()` with no options.
- Realworld: a hardcoded JWT secret fallback (3 places), no validation on request bodies and queries (6), open CORS, no rate limit on login, no HTTPS evidence. Arguable: eight low-confidence path-parameter findings and the hedged `POST /api/users` sign-up note.

A scan of NodeGoat (48 files) takes about 0.6 seconds.

### Known misses in this round

NodeGoat contains more than the scanner reports. Not detected, because no rule covers them: NoSQL injection, insecure session and cookie settings, a missing admin check on a route that does require login, server-side request forgery, a slow regular expression, and insecure direct object references. These are recorded in known-gaps.md.

## Result against the M4 gate

- At least one true finding confirmed by hand: yes, in all three projects.
- False positives per scan at most 3 (NFR-06): yes after fixes (0 wrong; the realworld scan has arguable low-confidence items).
- Run on the author's own live project: done in Round 2 below (Queueless). Two of its three first-run findings were wrong and were fixed.

## Round 2: the author's own NestJS project (2026-11-13)

First scan of a project the author wrote (Queueless, NestJS, 84 files, 25 routes). Each finding was checked by opening the file and line.

| Finding | Verdict | Why |
|---|---|---|
| `config/default-credentials` (BLOCKER), `strings.ts:75` | Wrong | The line is the label of the login form's password field (`password: 'Password'`), not a credential. The rule matched the key name and a value on its list. |
| `config/no-rate-limit-auth`, `auth.controller.ts:13` | Wrong | The project limits login per email and per IP in a `LoginThrottle` service called from `AuthService.login`, with tests. The scan only recognises limiters it can see on the route, and tagged the finding `[likely]`. |
| `config/no-https-redirect`, `main.ts:11` | True | Nothing set an HSTS header. The redirect itself is done by the host. The author added HSTS afterwards. |

Result: 1 true, 2 wrong (one of them a BLOCKER that also failed GL-01 and cost about 15 points). The first scan scored 81/100 and the score was misleading because of the false blocker.

Fixes, with must-fire and must-not-fire tests in `tests/rules.test.ts`: UI labels are skipped by the default-credentials rule; a limiter-named file lowers the rate-limit finding to low confidence and a handler that calls a throttle is skipped. After the fixes the same scan gave 99/100 with one low-confidence finding that names the real limiter file. The author still has to suppress it with a note, because the scan cannot follow the call into the service. This is recorded in known-gaps.md.

Also confirmed by hand: GL-01 should pass (the env file is ignored by git and only `.env.example` is tracked). Not checked by the scan: backups (GL-04) and dependencies, because the project uses pnpm and only npm lockfiles are audited.

The M4 gate is now met on the author's own project as well as the three open-source ones, with this caveat: two of three findings were wrong on the first run.

## How to repeat

```bash
npm run build
node dist/bin.js scan <project> --no-audit --no-history --format json > result.json
```

Then open each finding's file and line and mark it true, arguable or wrong. A wrong finding becomes a regression test and a fix, or a documented gap.
