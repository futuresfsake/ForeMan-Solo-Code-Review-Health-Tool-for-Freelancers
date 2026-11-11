<div align="center">

# Foreman Solo

**The code reviewer a solo freelance Node developer doesn't have.**

Scan any Node repo for security and quality problems, get a 0-100 health score and a go-live checklist, and hand your client a report that shows the work you did.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](docs/plans/milestones.md)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](docs/tech/tech-stack.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Quick start](#quick-start) · [Features](#features) · [Documentation](#documentation) · [Roadmap](#roadmap) · [Contributing](#contributing)

</div>

> **Project status: alpha.** The scanner works, is covered by tests, and has been checked by hand against three open-source Express apps ([results](docs/testing/validation-results.md)). It has not been proven on production codebases and it is not published to npm. Expect false positives and misses. Run it from a clone for now (see [Quick start](#quick-start)). Progress is tracked in [docs/plans/milestones.md](docs/plans/milestones.md).

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
| **Static analysis** | Parses your code into an AST. Never runs your app, never needs a database. |
| **Health score** | A 0-100 score weighted by severity and confidence. |
| **Go-live checklist** | A fixed gate: secrets removed, debug off, HTTPS, no stack-trace leaks, admin routes locked down, rate limiting on auth. |
| **Dependency check** | `npm audit` results reformatted into findings. |
| **Client-ready report** | `--report client` writes a plain-English summary with no code or file paths, ready to attach to an invoice, with your logo and colour if you set them in the config. `--report html` is the technical version. |
| **Risk in plain English** | Every finding says why it matters to the business, not just what the code does. |
| **Ongoing care** | `init --ci` adds a workflow that rescans on every push and once a week. |
| **Multi-client view** | `scan --all ./clients/*` prints one summary table with score, trend and last-scanned date. |
| **Private by design** | No accounts, no telemetry, nothing uploaded. |

Not built yet: simulated senior review (LLM, opt-in, with confidence levels and pushback), explain-my-code mode, and Fastify and Next.js support. See the [roadmap](#roadmap).

**What to rely on.** The dependable part is the static scan: it is deterministic, offline and never uses an LLM. The planned LLM review is an optional, experimental extra. It will run on a local model through [Ollama](https://ollama.com) by default, so nothing leaves your machine ([ADR-0007](docs/decisions/adr/0007-llm-provider-ollama-first.md)). Small local models can be wrong, so every comment will carry a confidence level and say it is machine-generated. Treat it as a second opinion, never as the review.

## Quick start

```bash
# Scan the current project
npx foreman-solo scan

# Also write a static HTML report
npx foreman-solo scan --report=html

# Scan every client project in a folder
npx foreman-solo scan --all "./clients/*"

# Write a plain-English summary for your client
npx foreman-solo scan --report client

# Fail a CI build if the score is too low
npx foreman-solo scan --fail-under 80

# Add a starter config and a weekly scan workflow to a project
npx foreman-solo init --ci
```

The package is not on npm yet, so the `npx` commands above will work only after the first release. Until then, run it from a clone:

```bash
git clone https://github.com/futuresfsake/ForeMan-Solo-Code-Review-Health-Tool-for-Freelancers.git foreman-solo
cd foreman-solo
npm install
npm run build
node dist/bin.js scan /path/to/your/project
```

Requires Node 20 or newer. Developed on Windows; macOS and Linux are expected to work but are not yet tested in CI.

## Example output

Abridged output from scanning a small demo app:

```
Foreman Solo  ·  demo-shop-api  ·  Express

Health score   37 / 100   (first scan)

Findings (11)
  BLOCKER      auth/missing-on-sensitive-route  routes/admin.js:2  [likely]
               DELETE /admin/users/:id is under "/admin" and has no authentication middleware.
  BLOCKER      injection/sql-concat  server.js:10
               SQL query is built by inserting request data (req.body.email) directly into the string.
  SHOULD-FIX   config/permissive-cors  server.js:5  [likely]
               cors() is called with no options, which allows every origin.
  SHOULD-FIX   config/no-https-redirect  server.js:4  [worth a second look]
               No HTTPS redirect or HSTS header was found in the code. This may be handled by your host or proxy.
  ...

Go-live checklist
  [ ] GL-01  Secrets removed from repo  (1 open finding(s))
  [?] GL-04  Backups configured  (cannot be checked from code; attest it in the config if it is done)
  [ ] GL-06  Admin/internal routes locked down  (1 open finding(s))
  ...

Not ready to ship: 6 failing, 1 unverified checklist item(s).

Automated static review, not a security audit, penetration test or certification.
```

## How it works

```
  your repo
     |
     v
  parse (TypeScript AST)  -->  framework adapter (Express, NestJS)
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

## Legal

Foreman Solo is provided under the MIT licence with no warranty. Its reports are automated findings, not professional security advice, and should not be presented to clients as proof that code is secure. Only scan code you are authorised to access. Foreman Solo is an independent project and is not affiliated with The Foreman (theforeman.org) or any other product named Foreman. See [docs/legal.md](docs/legal.md).

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M1 | CLI skeleton, project loader, parser | Done |
| M2 | Express adapter | Done |
| M3 | Rules, dependency check, score, checklist | Done |
| M4 | Reports and validation on real projects (**gate**) | Met on three open-source apps; author's own project pending |
| M5 | `scan --all`, history and trends, `init` | Done |
| M7 | Plain-English risk, branded client report | Done |
| M8 | Ongoing-care workflow sample | Done (`init --ci`) |
| M10 | More frameworks | NestJS done on fixtures; Fastify and Next.js not started |
| M6, M9 | LLM senior review, explain mode | Not started |

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
| [Validation results](docs/testing/validation-results.md) | What it found on real open-source apps, checked by hand |
| [Security and trust](docs/security-and-trust.md) | Data flow and limits |
| [Legal notes](docs/legal.md) | Licence, disclaimers, trademarks, third-party software |
| [Release process](docs/release-process.md) | Versioning and deprecation |
| [FAQ](docs/faq.md) | Common questions |

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a rule or a framework adapter without breaking public contracts, then open an issue or a pull request using the provided templates.

## License

[MIT](LICENSE)
