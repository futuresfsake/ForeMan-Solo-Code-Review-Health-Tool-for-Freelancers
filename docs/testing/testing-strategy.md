# Testing strategy

## Layers

| Layer | What | Tool |
|---|---|---|
| Unit | Scorer, checklist roll-up, suppression parsing, config merge | vitest |
| Rule tests | Each rule has a must-fire case (checked by rule ID and line) and a must-not-fire case | vitest (`tests/rules.test.ts`) |
| Adapter tests | Small Express apps -> expected routes, mounts and middleware | vitest (`tests/express.test.ts`) |
| CLI integration | Call `main(argv, io)` with captured output and a fake audit; assert output, exit code, generated files | vitest (`tests/cli.test.ts`) |
| Determinism | Run scan twice; JSON output must be byte-identical (modulo timestamp) | vitest |
| Security regression | One test per weakness found in a security review: a hostile project is built in a temp folder (a planted program, a link, a file made to exhaust the stack, a config that hides things, megabyte-long lines) and the test asserts the tool is not fooled | vitest (`tests/security.test.ts`, `tests/hardening.test.ts`) |
| Real-project validation | Run on real codebases; every finding judged true, arguable or wrong by hand; each wrong one becomes a regression test | manual, logged in [validation-results.md](validation-results.md), regressions in `tests/real-world-patterns.test.ts` |

## Fixtures

Fixtures are not stored on disk. Each test writes a throwaway project into the system temp folder (`tests/helpers.ts`) and deletes it afterwards. Fake credentials are assembled from fragments at runtime, so no secret-shaped string exists in the repository and secret scanners on the hosting platform are not triggered. Fixtures must never contain real secrets or personal data.

Tests never use the network: the `npm audit` call is injected and replaced with recorded output.

## Non-deterministic parts (LLM, M6+)

- The LLM is never in the static pass; all deterministic tests run without it.
- Mock the `LlmProvider` for unit/integration tests with recorded responses.
- Test the **harness**, not the model: context assembly (right dependent files included), prompt content, parsing of structured output, confidence and severity validation, pushback thread handling.
- A small golden set of seeded diffs with known issues is run manually against a real model before release; track hit rate and false-comment rate over time, not pass/fail.
- Guardrail tests: output not matching the schema is rejected and retried, never shown raw.

## `npm audit` isolation

Wrapped behind an interface; tests use recorded audit JSON. One optional online smoke test.

## CI

Run lint, tests, a build, and a CLI smoke test on Windows, macOS and Linux with Node 20, 22 and 24 (NFR-04). A second job checks the dependency tree (`npm audit`, `npm audit signatures`) and the contents of the package that would be published. CodeQL runs in its own workflow. Locally, `npm run check` runs the same steps, and the pre-push hook runs it for you ([safeguards.md](../security/safeguards.md)).

Tests that create a real git repository are slow on Windows runners; the per-test time limit is 30 seconds (`vitest.config.ts`).

## Security tests

The scanned project is the attacker's input, so the security tests build hostile projects rather than mock them:

- Each test names the finding it guards (F-01 to F-08 in [security-audit.md](../security/security-audit.md)).
- A test that needs a link uses a directory junction on Windows, which needs no special rights, and a symlink elsewhere.
- A test that plants a program uses a harmless script that only writes a marker file, and asserts the marker does not exist.
- Timing tests feed megabyte-long hostile lines and assert a generous upper bound, so they fail on a quadratic pattern without being flaky.
- The glob matcher is checked against the regular-expression matcher it replaced on 100,000 random patterns and paths.

A change that starts a program, writes a file, prints text from the project or adds a pattern that runs over whole lines needs a test here.
