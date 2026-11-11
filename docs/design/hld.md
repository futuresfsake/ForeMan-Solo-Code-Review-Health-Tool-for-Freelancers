# High-level design

## System diagram

```
                 foreman scan [path | --all glob]
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
                  |  Parser (ts-morph)    |  AST, no execution
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
| Parser | ts-morph project over JS/TS |
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
| Robust | Per-file parse isolation; per-rule try/catch converted to warnings |

## Boundaries

- Reads the target repo; writes only reports and `.foreman/` history.
- Spawns `npm audit` as a child process.
- Post-MVP: calls an LLM provider only when the user enables it and supplies a key.
