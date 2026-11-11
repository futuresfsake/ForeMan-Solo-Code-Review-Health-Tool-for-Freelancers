# Testing strategy

## Layers

| Layer | What | Tool |
|---|---|---|
| Unit | Scorer, checklist roll-up, suppression parsing, config merge | vitest |
| Rule tests | Each rule runs on `bad/` fixture (must fire, exact line) and `good/` fixture (must not fire) | vitest |
| Adapter snapshots | Fixture Express apps -> expected `ProjectModel` JSON | vitest snapshots |
| CLI integration | Spawn the CLI on fixtures; assert stdout, exit code, generated files | vitest |
| Determinism | Run scan twice; JSON output must be byte-identical (modulo timestamp) | vitest |
| Reference-project validation | Run on the author's real projects; every finding triaged true/false; FP count recorded per release | manual, logged in `tests/reference/RESULTS.md` |

## Fixtures

`tests/fixtures/<rule-id>/{bad,good}/` plus `tests/fixtures/apps/` (whole small apps) and `tests/fixtures/clients/` (for `--all`). Fixtures must contain only fake secrets and no personal data.

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
