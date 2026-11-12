# High-level design

## Architecture style

Foreman Solo is a **modular monolithic CLI**: one program, run locally, with nothing deployed. It is not a microservice system and has no server (ADR-0001).

| Aspect | Style | Where |
|---|---|---|
| Overall flow | Pipeline: load, parse, adapt, run rules, score, report. Each stage only passes data to the next | `src/scan.ts` |
| Framework support | Adapter pattern: framework-specific code produces a normalized `ProjectModel`; rules never see the framework | `src/adapters/` |
| Rules | Plugin-style: independent rule groups registered in one list, described by one catalog | `src/rules/` |
| Output | Reporters all read the same `ScanResult` | `src/report/` |
| Network access | Injected: the dependency audit is passed in, so it can be replaced or turned off | `RuleContext.audit` |

NFR-12 is shown by a second adapter: NestJS emits the same model and the auth and rate-limit rules run on it with no rule changes (`tests/nestjs.test.ts`). The adapter list is `src/adapters/index.ts`.

## System diagram

```
                 foreman-solo scan [path | --all glob]
                              |
                        +-----v------+
                        |    CLI     |  commander
                        +-----v------+
                              |
                  +-----------v-----------+
                  |   Project loader      |  files, package.json, config, context file
                  +-----------+-----------+
                              |
                  +-----------v-----------+
                  |  Parser (TypeScript) |  AST, no execution
                  +-----------+-----------+
                              |
                  +-----------v-----------+
                  |  Framework adapter    |  Express -> routes, middleware, models
                  +-----------+-----------+
                              | normalized ProjectModel
        +----------+----------+----------+-----------+
        |          |          |          |           |
   secrets     injection   validation   auth     config      deps (npm audit)
        \          \          |          /           /           /
         +----------+---------+---------+-----------+-----------+
                              | Finding[]
                  +-----------v-----------+
                  |  Aggregator           |  dedupe, suppressions, severity
                  +-----+-----------+-----+
                        |           |
               +--------v--+   +----v--------+
               | Scorer    |   | Checklist   |
               +--------+--+   +----+--------+
                        +-----+-----+
                              |  ScanResult
              +---------------+----------------+
              |               |                |
          Terminal         HTML/MD/JSON     History (local JSON)
```

Post-MVP: `ScanResult` + diff + dependent files feed the **LLM context pass** (`review`, `explain`, risk narratives). It consumes the static output; it never replaces it.

## Components

| Component | Responsibility |
|---|---|
| CLI | Flags, orchestration, exit codes |
| Project loader | Collect files (respecting ignores), read `package.json`, config, context file |
| Parser | TypeScript compiler API, parse-only, one file at a time |
| Adapter | Framework-specific extraction to a normalized `ProjectModel` |
| Rules | Pure functions `(ProjectModel, ctx) -> Finding[]`, framework-agnostic |
| Aggregator | Merge, dedupe, apply suppressions |
| Scorer | Weighted 0-100 formula |
| Checklist | Map findings to fixed go-live items |
| Reporters | Terminal, HTML, Markdown, JSON |
| History | Per-project score log for trend |
| LLM layer (post-MVP) | Context assembly, prompting, confidence, pushback |

## Data flow

1. Load project and config.
2. Parse to AST; adapter builds `ProjectModel`.
3. Run rules in parallel; each emits findings.
4. Aggregate, score, evaluate checklist.
5. Render outputs; append to history.
6. Exit code from blockers / `--fail-under`.

## Quality attributes

| Attribute | How the design delivers it |
|---|---|
| Deterministic | Static pass is pure; no network except `npm audit` (isolated, optional) |
| Extensible | Adapter + rule interfaces; core knows neither |
| Private | No server; reports are local files |
| Honest | Confidence on every finding; checklist lists unchecked items |
| Robust | Per-file parse isolation; a file too large, too deep or unparsable is set aside with a warning; a rule that fails marks the result incomplete (exit 3) instead of passing |
| Safe on hostile input | The scanned project is untrusted: programs by absolute path only, no write through a link, project text cleaned before any output, bounded patterns (lld.md, "Untrusted input") |

## Boundaries

- Reads the target repo; writes only reports and `.foreman/` history, never through a link and never outside the working folder unless `--out` says so.
- Spawns `npm audit`, and `git` for read-only queries, as child processes, found on `PATH` by absolute path and never inside the scanned project.
- Trust boundary: everything inside the scanned folder (source, `package.json`, `foreman.config.json`, `.npmrc`, `.git/config`, `.foreman/`, links, programs) is attacker-controlled input. The command line and a config passed with `--config` are the user's own.
- Post-MVP: calls an LLM provider only when the user enables it and supplies a key.
