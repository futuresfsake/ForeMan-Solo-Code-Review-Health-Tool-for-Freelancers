# Configuration reference

Precedence: CLI flag > config file > default. Zero configuration works.

## Config file: `foreman.config.json`

Placed in the root of the scanned project (or passed with `--config`). Unknown keys are rejected so typos are not silently ignored.

A config in the project folder may have been written by whoever wrote the project. See [Config that comes with a project](#config-that-comes-with-a-project).

```json
{
  "ignorePaths": ["legacy", "scripts/**"],
  "failUnder": 80,
  "audit": { "enabled": true },
  "sensitiveRoutes": {
    "pathPatterns": ["/admin", "/internal", "/users", "/account", "/payments", "/billing"],
    "methods": ["POST", "PUT", "PATCH", "DELETE"],
    "publicPaths": ["/login", "/register", "/webhook", "/health"]
  },
  "authMiddlewareNames": ["mustBeStaff"],
  "weights": { "blocker": 15, "should-fix": 5, "nice-to-have": 1 },
  "confidenceFactor": { "high": 1, "medium": 0.6, "low": 0.3 },
  "rules": { "config/permissive-cors": "off", "deps/no-lockfile": "should-fix" },
  "ignore": [{ "ruleId": "secrets/hardcoded-password", "file": "seed/**", "reason": "demo seed data" }],
  "checklist": { "attest": { "GL-04": "Daily database backup by the host, verified 2026-11-01" } },
  "report": { "outDir": "./foreman-report", "projectName": "Acme Shop API", "preparedBy": "Sam Rivera", "clientName": "Acme Ltd", "logo": "brand/logo.png", "accentColor": "#2f5bd8" },
  "llm": { "model": "qwen2.5-coder:7b", "endpoint": "http://localhost:11434" }
}
```

| Key | Default | Meaning |
|---|---|---|
| `ignorePaths` | `node_modules`, `dist`, `build`, `coverage`, `*.test.*`, `*.spec.*`, `__tests__`, `__mocks__`, `test`, `tests`, `e2e`, `cypress`, `fixtures`, `*.min.js` | Extra paths to skip, added to the defaults. A name with no slash matches any path segment. `.env` files are always checked |
| `failUnder` | `0` | Exit with code 1 when the score is below this |
| `audit.enabled` | `true` | Run `npm audit`. Same as `--no-audit` when false |
| `sensitiveRoutes.pathPatterns` | see above | Routes under these paths must have authentication (blocker) |
| `sensitiveRoutes.methods` | write methods | Other routes using these methods without authentication are reported as should-fix, low confidence |
| `sensitiveRoutes.publicPaths` | login, register, logout, refresh, verify, forgot, reset, oauth, callback, webhook, health and similar | Paths that are public on purpose. `/reset` also covers `/reset-password` |
| `authMiddlewareNames` | `[]` | Extra middleware names that count as authentication. Common names (auth, jwt, passport, protect, guard) are built in |
| `weights`, `confidenceFactor` | see above | Score formula inputs (see lld.md) |
| `rules.<id>` | catalog default | `"off"` or a severity override. A go-live item whose rule is off becomes `unverified`, not `pass` |
| `ignore[]` | `[]` | Suppress a rule, optionally for a file glob. `reason` is required and shown in the report |
| `checklist.attest.<id>` | none | A note confirming an item that cannot be checked from code. Turns `unverified` into `pass`; never overrides `fail` |
| `report.outDir` | `./foreman-report` | Where report files go. Must be a relative folder below the one you run the scan from: an absolute path, a drive letter or `..` is a config error (exit 2). To write anywhere else, use `--out` on the command line |
| `report.projectName` | package name or folder name | Name shown in reports |
| `report.preparedBy`, `report.clientName` | empty | Shown on the client report (`--report client`) |
| `report.logo` | empty | Path to your logo, relative to the project and inside it: png, jpg, gif, webp or svg, up to 256 KB. A logo kept elsewhere is accepted only from a config you pass with `--config`. Embedded in the client report, so the report stays one file with no external requests. A missing or oversized file is a usage error (exit 2) |
| `llm.provider` | `ollama` | Only `ollama` exists. Used by `foreman-solo review`; the scan ignores `llm` |
| `llm.model` | `qwen2.5-coder:7b` | The Ollama model to use. Install it first with `ollama pull <model>`. `--model` overrides it. A name ending in `cloud` (an Ollama cloud model) is rejected, because it would send code to Ollama's servers |
| `llm.endpoint` | `http://localhost:11434` | Where Ollama listens. Must be `localhost`, `127.0.0.1` or `[::1]`: anything else is rejected, and redirects are not followed, so code is never sent to another machine |
| `report.accentColor` | empty | A `#rrggbb` colour used for the client report's top border and section markers |

## Config that comes with a project

When you scan code someone else wrote, `foreman.config.json` in that folder is their file. It can ignore folders, turn rules off, set every score weight to zero, name their own middleware as "authentication" and attest checklist items. Three things keep that visible and contained:

- **Every output says what the config changed.** The terminal, HTML, Markdown and client reports name the keys that differ from the defaults (`coverage.configChanges` in JSON), for example `The config in effect changes the scan: ignorePaths, weights, rules.`
- **`--no-project-config` ignores the file** and scans with the defaults. Use it for the first scan of a project you do not trust yet. `--config <file>` uses your own file instead.
- **The config cannot reach outside the project.** `report.outDir` must stay below the working folder, `report.logo` must be a file inside the project, and `llm.endpoint` must be this machine.

The same applies to `// foreman-ignore` comments in the code: they are counted in the terminal output and listed with their reasons in the HTML and Markdown reports.

## Inline suppression

```js
// foreman-ignore auth/missing-on-sensitive-route: public webhook, verified by signature
app.post('/admin/hooks/stripe', handler);
```

On the finding's line or the line above. A suppression without a reason is ignored and produces a warning.

## Flags

See [lld.md](../design/lld.md#cli).

## Environment variables

| Variable | Effect |
|---|---|
| `NO_COLOR` or `FOREMAN_NO_COLOR` | Disable coloured output |
| `FOREMAN_LLM_API_KEY` | Reserved for post-MVP LLM features; not read today |

## Context file (`--context`)

Free-form Markdown or JSON describing requirements or which fields are personal data. Reserved for post-MVP features; today the scan only checks that the file is readable.
