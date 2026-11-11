<div align="center">

# Foreman Solo

**The code reviewer a solo freelance Node developer doesn't have.**

Scan any Node repo for security and quality problems, get a 0-100 health score and a go-live checklist, and hand your client a report that shows the work you did.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: pre-MVP](https://img.shields.io/badge/status-pre--MVP-orange.svg)](docs/plans/milestones.md)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](docs/tech/tech-stack.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Quick start](#quick-start) · [Features](#features) · [Documentation](#documentation) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

> **Project status:** Foreman Solo is in its documentation-first phase. The design, requirements and roadmap are written; the CLI is not implemented yet. The commands below describe the planned interface, not something you can install today. Progress is tracked in [docs/plans/milestones.md](docs/plans/milestones.md).

---

## Why Foreman Solo?

A freelancer ships code with no senior dev, no reviewer and no security team looking at it first.

- Nobody reviews your pull requests before they reach a client's production app.
- Security and quality work is invisible to clients, so it is hard to charge for.
- You inherit half-finished codebases with no map of what is risky.
- Once a project ships, its dependencies quietly rot.
- A breach on a past client's site turns into an emergency call with no warning.

Foreman Solo is built for running a freelance business, not just linting code. It produces things you can show a client, bill for, and use to keep many projects under control at once.

## Features

| | |
|---|---|
| **One command** | `npx foreman-solo scan` in any Node repo. No sign-up, no server, no config. |
| **Static analysis, not guesswork** | Parses your code into an AST. Never runs your app, never needs a database. |
| **Health score** | A 0-100 score weighted by severity and confidence. |
| **Go-live checklist** | A fixed gate: secrets removed, debug off, HTTPS, no stack-trace leaks, admin routes locked down, rate limiting on auth. |
| **Dependency check** | `npm audit` results reformatted into findings. |
| **Client-ready report** | A single self-contained HTML file you can attach to an invoice. |
| **Multi-client view** | `scan --all ./clients/*` prints one summary table with score, trend and last-scanned date. |
| **Private by design** | No accounts, no telemetry, nothing uploaded. |

Planned after the MVP: simulated senior review (LLM, opt-in, with confidence levels and pushback), plain-English risk-in-money explanations, ongoing-care scheduling, explain-my-code mode, and NestJS, Fastify and Next.js support. See the [roadmap](#roadmap).

## Quick start

```bash
# Scan the current project
npx foreman-solo scan

# Also write a static HTML report
npx foreman-solo scan --report=html

# Scan every client project in a folder
npx foreman-solo scan --all "./clients/*"

# Fail a CI build if the score is too low
npx foreman-solo scan --fail-under 80
```

Requires Node 20 or newer. Works on Windows, macOS and Linux.

## Example output

An illustration of the planned terminal report:

```
Foreman Solo  ·  my-client-api  ·  Express

Health score   72 / 100   (trend: up)

Findings
  BLOCKER     secrets/hardcoded-api-key        src/config/stripe.js:12
  BLOCKER     auth/missing-on-sensitive-route  src/routes/admin.js:8   DELETE /admin/users/:id
  SHOULD-FIX  validation/unvalidated-param     src/routes/orders.js:31
  SHOULD-FIX  config/permissive-cors           src/app.js:19

Go-live checklist
  [x] GL-01  Secrets removed from repo
  [ ] GL-06  Admin/internal routes locked down
  [?] GL-04  Backups configured (cannot be checked from code, attest in config)

Not ready to ship: 1 failing item, 1 unverified.
```

## How it works

```
  your repo
     |
     v
  parse (ts-morph AST)  -->  framework adapter (Express first)
     |
     v
  rules: secrets · injection · validation · auth · config · dependencies
     |
     v
  findings  -->  health score  +  go-live checklist
     |
     v
  terminal report · HTML / Markdown / JSON · local history for trends
```

The static pass is deterministic and offline (apart from `npm audit`). The later senior-review layer feeds those confirmed facts to an LLM instead of making it reason from nothing. See [ADR-0002](docs/decisions/adr/0002-two-layer-static-then-llm.md) and the [high-level design](docs/design/hld.md).

## Configuration

Zero setup works. To tune it, add `foreman.config.json`:

```json
{
  "failUnder": 80,
  "sensitiveRoutes": { "pathPatterns": ["/admin", "/payments"] },
  "rules": { "config/permissive-cors": "off" },
  "checklist": { "attest": { "GL-04": "Daily DB backup via host" } }
}
```

Full reference: [docs/tech/configuration.md](docs/tech/configuration.md).

## Privacy and trust

- No telemetry, no accounts, no update pings.
- Your code is read, never executed or modified.
- The only network call in the core scan is `npm audit`.
- Foreman Solo is **not** a security audit, penetration test or certification. A high score means the checked rules found little, nothing more.

Details: [docs/security-and-trust.md](docs/security-and-trust.md).

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M1 | CLI skeleton, project loader, parser | Planned |
| M2 | Express adapter | Planned |
| M3 | Rules, dependency check, score, checklist | Planned |
| M4 | Reports and validation on a real project (**gate**) | Planned |
| M5 | `scan --all`, history and trends, `init` | Planned |
| M6+ | LLM senior review, risk-in-money, care mode, explain mode, more frameworks | Later |

Order and reasoning: [docs/plans/roadmap.md](docs/plans/roadmap.md).

## Documentation

| Doc | What's in it |
|---|---|
| [Overview](docs/00-overview.md) | Problem, audience, definition of done, out of scope |
| [Glossary](docs/glossary.md) | Domain terms |
| [Functional requirements](docs/requirements/functional.md) | FR-01 to FR-30 |
| [Non-functional requirements](docs/requirements/non-functional.md) | NFR-01 to NFR-14 |
| [High-level design](docs/design/hld.md) | Components and data flow |
| [Low-level design](docs/design/lld.md) | CLI spec, types, rules, schema |
| [Tech stack](docs/tech/tech-stack.md) | Choices and what was rejected |
| [Configuration](docs/tech/configuration.md) | Config file, flags, env vars |
| [Decisions (ADRs)](docs/decisions/adr) | Why things are the way they are |
| [Milestones](docs/plans/milestones.md) | Scope and exit criteria |
| [Known gaps](docs/gaps/known-gaps.md) · [Risks](docs/gaps/risks.md) | What it won't do, what could go wrong |
| [Testing strategy](docs/testing/testing-strategy.md) | How it is tested |
| [Security and trust](docs/security-and-trust.md) | Data flow and limits |
| [Release process](docs/release-process.md) | Versioning and deprecation |
| [FAQ](docs/faq.md) | Common questions |

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a rule or a framework adapter without breaking public contracts, then open an issue or a pull request using the provided templates.

## License

[MIT](LICENSE)
