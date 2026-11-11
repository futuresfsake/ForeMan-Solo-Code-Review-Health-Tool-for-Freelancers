# ADR-0002: Two-layer design: deterministic pass, then LLM context pass

- Status: Accepted (2026-11-11)

## Context

"Senior-level" review needs reasoning, but LLMs alone hallucinate and lack facts; static analysis is reliable but narrow.

## Decision

1. A deterministic AST pass runs first, offline, in milliseconds, and is always right about what it checks.
2. Its findings plus the diff and the files the diff depends on become context for an LLM reasoning pass (post-MVP).
3. LLM output carries confidence levels and supports developer pushback.

The MVP ships layer 1 only.

## Consequences

- MVP is useful and testable without any LLM.
- The static pass must never depend on the LLM layer.
- Known limit: no institutional memory of a client's history, no accountability, can be confidently wrong. Confidence and pushback are load-bearing.
