# ADR-0007: LLM layer starts with local Ollama behind a provider interface

- Status: Accepted (2026-11-12)
- Builds on: ADR-0002 (two-layer design)

## Context

M6 needs an LLM. A freelancer's reports and code are confidential client material (security-and-trust.md), so sending code to a third party by default would break the "private by design" promise. Free cloud tiers often allow prompts to be used for training, and their limits change. The author's machine (6 GB GPU, 16 GB RAM) can run a 7B model locally.

## Decision

1. **Ollama is the first and default provider.** It runs on the user's machine, needs no key and no account, and sends nothing off the machine.
2. **A small provider interface** (`complete(prompt) -> string`) sits between the review engine and any model, so the engine does not know which provider is behind it.
3. **Ollama's own HTTP API on `localhost:11434`**, called with Node's built-in `fetch`. No new runtime dependency.
4. **Opt-in only.** `scan` never calls an LLM. The LLM layer is a separate command (`foreman-solo review`), so the static pass stays offline and deterministic (ADR-0002, NFR).
5. **Remote providers come later and are explicit.** A non-local endpoint needs the user to configure it and acknowledge that code leaves the machine. The key is read from the environment, never from the config file.
6. **Static findings go in as facts.** The prompt includes the deterministic findings, and the model is asked not to contradict them (FR-21).
7. **Output is always labelled and hedged.** Every comment carries a confidence level and a severity (FR-22, FR-24). The report says the review was machine-generated and may be wrong.
8. **A small default model, replaceable by config.** The first model tried is `qwen2.5-coder:7b`; the model name is a config value, not code.

## Consequences

- The LLM layer works free, offline and privately, at the cost of weaker answers than a large hosted model. Confidence levels and pushback (FR-23) carry more weight for that reason.
- Review speed depends on the user's hardware; a large diff may need to be split.
- Provider choice is not locked in: adding a hosted provider later is one new implementation of the interface plus the explicit consent step.
- Tests use a fake provider so the suite never needs a model or a network.
