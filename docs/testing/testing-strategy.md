# Testing strategy

## Layers

| Layer | What | Tool |
|---|---|---|
| Unit | Scorer, checklist roll-up, suppression parsing, config merge | vitest |
| Rule tests | Each rule has a must-fire case (checked by rule ID and line) and a must-not-fire case | vitest (`tests/rules.test.ts`) |
| Adapter tests | Small Express apps -> expected routes, mounts and middleware | vitest (`tests/express.test.ts`) |
| CLI integration | Call `main(argv, io)` with captured output and a fake audit; assert output, exit code, generated files | vitest (`tests/cli.test.ts`) |
| Determinism | Run scan twice; JSON output must be byte-identical (modulo timestamp) | vitest |
| Reference-project validation | Run on the author's real projects; every finding triaged true/false; FP count recorded per release | manual, logged in `tests/reference/RESULTS.md` |

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

Run lint, tests, a build, and a CLI smoke test on Windows, macOS and Linux (NFR-04).
