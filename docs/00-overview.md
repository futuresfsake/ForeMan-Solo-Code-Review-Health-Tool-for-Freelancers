# Overview

## Problem

A solo freelance Node developer ships code with no senior dev, no reviewer and no security team checking it before the client sees it.

1. Nobody reviews their PRs before they reach a client's production app.
2. Security and quality work is invisible to clients, so it is hard to charge for.
3. They constantly inherit half-finished codebases with no map of what is risky.
4. After shipping they move on and dependencies quietly rot.
5. A breach on a past client's site becomes an emergency call with no warning.

## Who it's for

- Solo and small-team freelance Node developers (Express, NestJS, Fastify, Next.js)
- Consultancies of 1-5 people
- Agencies that outsource to solo contractors and want some assurance of quality

## Relationship to the capstone version

The original capstone version of this idea is about learning and defence prep. Foreman Solo is about running a freelance business: it must produce things a freelancer can show a client, bill for, and use to keep several projects under control. The scanner core (vulnerabilities, dependency/secrets/config checks, health score) is shared; client- and business-facing parts are new.

## Product shape (decided: ADR-0001)

A local, open-source **CLI only**. `npx foreman-solo scan` is the whole interface. No server, no accounts, no hosted frontend, no telemetry. "Frontend" = terminal output plus an optional static HTML file written to disk.

## The seven capabilities

| # | Capability | Delivered as | Phase |
|---|---|---|---|
| 1 | Simulated senior review (context-aware, stepwise, confidence-tagged, pushback) | `foreman review` | Post-MVP (M6) |
| 2 | Go-live checklist | in `foreman scan` | MVP |
| 3 | Client-ready report | `--report=html` | MVP (basic), M7 (branding) |
| 4 | Risk-in-money terms | finding field | M7 |
| 5 | Ongoing care mode | cron / GitHub Action sample | M8 |
| 6 | Explain-my-code | `foreman explain` | M9 |
| 7 | Multi-client view | `foreman scan --all` | MVP-late (M5) |

## What "done" means for the MVP

On a real live project of the author's own (capstone or Resibo), `foreman scan`:

- runs in seconds with no network except `npm audit`,
- finds at least one true issue,
- produces no more false positives than the author tolerates (target in NFR-06),
- prints a go-live checklist and a 0-100 score,
- writes an HTML report that is acceptable to attach to an invoice.

## Explicitly NOT in scope (MVP)

Hosted dashboard, accounts, billing/tiers, client-ready PDF export, LLM-powered narratives or review, Spec Guard, Privacy Check, Panel Mode, mentor/learning layer, frameworks other than Express, running the target app.

Rationale: build a scanner that catches real things before wrapping it. See [known-gaps.md](gaps/known-gaps.md).
