# Configuration reference

Precedence: CLI flag > config file > default.

## Config file: `foreman.config.json`

```json
{
  "ignorePaths": ["node_modules", "dist", "coverage", "**/*.test.*"],
  "framework": "auto",
  "failUnder": 0,
  "audit": { "enabled": true, "failOnLevel": "high" },
  "sensitiveRoutes": {
    "pathPatterns": ["/admin", "/users", "/payments"],
    "methods": ["POST", "PUT", "PATCH", "DELETE"]
  },
  "authMiddlewareNames": ["auth", "authenticate", "requireAuth", "passport.authenticate"],
  "weights": { "blocker": 15, "should-fix": 5, "nice-to-have": 1 },
  "confidenceFactor": { "high": 1.0, "medium": 0.6, "low": 0.3 },
  "rules": { "config/permissive-cors": "off" },
  "ignore": [{ "ruleId": "secrets/hardcoded-password", "file": "tests/**", "reason": "test fixtures" }],
  "checklist": { "attest": { "GL-04": "Daily DB backup via host, verified 2026-11-01" } },
  "report": { "outDir": "./foreman-report", "projectName": "" }
}
```

`rules.<id>`: `"off"` or a severity override.

## Flags

See [lld.md](../design/lld.md#cli).

## Environment variables

| Variable | Effect |
|---|---|
| `FOREMAN_NO_COLOR` | Disable colored output (`NO_COLOR` also honoured) |
| `FOREMAN_CONFIG` | Config path override |
| `FOREMAN_LLM_API_KEY` | (post-MVP) key for LLM features; never read unless an LLM command is run |

## Context file (`--context`)

Free-form Markdown/JSON describing requirements or which fields are personal data. Consumed by post-MVP features; MVP only validates it is readable.
