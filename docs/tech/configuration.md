# Configuration reference

Precedence: CLI flag > config file > default. Zero configuration works.

## Config file: `foreman.config.json`

Placed in the root of the scanned project (or passed with `--config`). Unknown keys are rejected so typos are not silently ignored.

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
  "report": { "outDir": "./foreman-report", "projectName": "Acme Shop API", "preparedBy": "Sam Rivera", "clientName": "Acme Ltd", "logo": "brand/logo.png", "accentColor": "#2f5bd8" }
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
| `rules.<id>` | catalog default | `"off"` or a severity override |
| `ignore[]` | `[]` | Suppress a rule, optionally for a file glob. `reason` is required and shown in the report |
| `checklist.attest.<id>` | none | A note confirming an item that cannot be checked from code. Turns `unverified` into `pass`; never overrides `fail` |
| `report.outDir` | `./foreman-report` | Where report files go |
| `report.projectName` | package name or folder name | Name shown in reports |
| `report.preparedBy`, `report.clientName` | empty | Shown on the client report (`--report client`) |
| `report.logo` | empty | Path to your logo, relative to the project: png, jpg, gif, webp or svg, up to 256 KB. Embedded in the client report, so the report stays one file with no external requests. A missing or oversized file is a usage error (exit 2) |
| `report.accentColor` | empty | A `#rrggbb` colour used for the client report's top border and section markers |

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
