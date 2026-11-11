# ADR-0003: ts-morph AST parsing with framework adapters

- Status: Accepted (2026-11-11). The parser choice is superseded by ADR-0006; the adapter design stands.

## Context

Must work on any Node repo without booting it, a DB or test data. Must extend to several frameworks.

## Decision

Parse with ts-morph (static). Framework knowledge lives in small adapters that emit a normalized `ProjectModel`; rules are framework-agnostic and consume only that model. Express first.

## Consequences

- New framework = new adapter, no scanner rewrite.
- Dynamic route registration (computed paths, runtime plugins) may be missed; recorded in known-gaps.
- tree-sitter remains an option if non-JS/TS support or speed demands it.
