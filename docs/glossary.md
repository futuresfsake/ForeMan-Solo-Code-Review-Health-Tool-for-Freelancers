# Glossary

| Term | Definition |
|---|---|
| Adapter (framework adapter) | Small plugin that finds a framework's routes, middleware and models and emits a normalized model. One per framework. |
| AST | Abstract syntax tree. Foreman parses code into it (ts-morph) instead of running the app. |
| Blocker / Should-fix / Nice-to-have | Severity tags on review comments. Blocker = do not merge/ship. |
| Care mode | Scheduled recurring scan of a shipped project to catch new CVEs and config drift. Implemented via cron/GitHub Action, not a service. |
| Check | A group of rules in one category (secrets, deps, config, ...). |
| Client-ready report | Non-technical, brandable HTML summary of review work for the client. |
| Confidence | high / medium / low on a finding. Deterministic rules are `high`; LLM findings may be lower. |
| Context pass | The LLM reasoning layer fed with static findings, the diff and dependent files. |
| Finding | One issue reported by a rule: id, severity, location, message, confidence, remediation. |
| Go-live checklist | Fixed pass/fail gate of items that must all be green before handoff. |
| Health score | 0-100 number derived from findings by a weighted formula. |
| Project context file | Optional file passed at scan time (requirements, personal-data fields). Engine has no project-specific assumptions. |
| Risk-in-money | Plain-English business consequence attached to a finding. |
| Rule | A single deterministic detector with a permanent ID, e.g. `secrets/hardcoded-api-key`. |
| Scan | One run of the static pass on one project. |
| Static pass | Deterministic, fast, offline analysis. Always runs first. |
| Trend | Direction of score vs previous scan (up/flat/down). Needs stored history (local JSON). |
| Two-layer design | Static pass first, then LLM context pass using the static facts. |
