# Low-level design

Contracts below are stable once released (NFR-10). TypeScript notation.

## CLI

```
foreman scan [path]            default path = .
  --all <glob...>             scan many projects, print summary table
  --report <html|md>          write report file
  --out <dir>                 report output dir (default ./foreman-report)
  --format <text|json>        stdout format (default text)
  --context <file>            project context file
  --fail-under <0-100>        exit 1 if score below
  --config <file>             default foreman.config.json
  --no-audit                  skip npm audit (offline)
  --brand <file>              (M7) branding json
foreman init                   write config + sample CI/cron
foreman review [--diff <ref>]  (M6)
foreman explain [path]         (M9)
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Scan ok, no blockers, score >= threshold |
| 1 | Blockers found or score below `--fail-under` |
| 2 | Usage / config error |
| 3 | Internal error |

## Core types

```ts
type Severity = "blocker" | "should-fix" | "nice-to-have";
type Confidence = "high" | "medium" | "low";

interface Finding {
  ruleId: string;            // "secrets/hardcoded-api-key"
  severity: Severity;
  confidence: Confidence;
  file: string;              // repo-relative, forward slashes
  line: number;
  message: string;
  remediation: string;
  checklistItems: string[];  // ids from checklist below
  riskInMoney?: string;      // M7
  suppressed?: { reason: string };
}

interface RouteInfo {
  method: string; path: string; file: string; line: number;
  params: string[];
  middleware: string[];      // resolved names in order
  handlerRef: string;
}

interface ProjectModel {
  root: string;
  framework: "express" | "unknown";
  routes: RouteInfo[];
  appMiddleware: string[];
  files: SourceFileRef[];
  packageJson: unknown;
  context?: unknown;
}

interface Rule {
  id: string;
  category: "secrets" | "injection" | "validation" | "auth" | "config" | "deps";
  defaultSeverity: Severity;
  run(model: ProjectModel, ctx: RuleContext): Finding[];
}

interface FrameworkAdapter {
  name: string;
  detect(root: string, pkg: unknown): boolean;
  build(project: ParsedProject): ProjectModel;
}
```

## MVP rule catalog

| Rule ID | Category | Default severity | Notes |
|---|---|---|---|
| secrets/hardcoded-api-key | secrets | blocker | known key patterns + entropy |
| secrets/hardcoded-password | secrets | blocker | assignments to password/secret vars |
| secrets/committed-env | secrets | blocker | `.env` tracked or not git-ignored |
| injection/sql-concat | injection | blocker | concat/template into query call |
| validation/unvalidated-param | validation | should-fix | req.params/body/query used raw in sinks |
| auth/missing-on-sensitive-route | auth | blocker | heuristic: admin/write/user paths |
| config/debug-enabled | config | should-fix | NODE_ENV dev default, `app.set('env')`, verbose errors |
| config/no-https-redirect | config | should-fix | no redirect/HSTS (helmet) |
| config/permissive-cors | config | should-fix | `origin: *` or `cors()` default with credentials |
| config/default-credentials | config | blocker | example/default creds in config |
| config/stack-trace-leak | config | should-fix | error handler sends `err.stack` |
| config/no-rate-limit-auth | config | should-fix | login/auth routes lacking limiter |
| deps/vulnerable | deps | by npm audit level | critical/high = blocker |
| deps/no-lockfile | deps | nice-to-have | |

## Go-live checklist

| ID | Item | Satisfied when no unsuppressed findings from |
|---|---|---|
| GL-01 | Secrets removed from repo | secrets/* |
| GL-02 | Debug/dev mode off | config/debug-enabled |
| GL-03 | HTTPS enforced | config/no-https-redirect |
| GL-04 | Backups configured | manual attestation (`checklist.attest.GL-04` in config) |
| GL-05 | Error pages don't leak stack traces | config/stack-trace-leak |
| GL-06 | Admin/internal routes locked down | auth/missing-on-sensitive-route |
| GL-07 | Rate limiting on auth routes | config/no-rate-limit-auth |

Item states: `pass`, `fail`, `unverified` (cannot be checked statically). "Ready to ship" only when all are `pass`. GL-04 is `unverified` until attested; the report says so.

## Health score

```
penalty = sum(weight[severity] * confidenceFactor) over unsuppressed findings
score   = clamp(round(100 - penalty), 0, 100)
```

Defaults: blocker 15, should-fix 5, nice-to-have 1. confidenceFactor: high 1.0, medium 0.6, low 0.3. Per-rule cap of 3 findings counted toward penalty to avoid one repeated issue zeroing the score. Tunable in config.

## JSON report schema (v1)

```json
{
  "schemaVersion": 1,
  "tool": "foreman", "toolVersion": "0.1.0",
  "scannedAt": "ISO-8601", "project": {"name": "", "root": ""},
  "score": 82, "trend": "up|flat|down|none",
  "checklist": [{"id":"GL-01","status":"pass|fail|unverified"}],
  "findings": [],
  "coverage": {"filesScanned": 0, "filesFailedToParse": 0, "rulesRun": [], "rulesSkipped": []}
}
```

## History

`.foreman/history.json` inside each scanned project (git-ignored by `foreman init`): array of `{scannedAt, score, findingCount}`. Trend = compare latest two.

## Suppression

Inline `// foreman-ignore <ruleId>: <reason>` or config `ignore: [{ruleId, file, reason}]`. Reason is mandatory; suppressions are listed in the report.

## Post-MVP interfaces (sketch)

- `ContextBuilder(diff, model) -> {changedFiles, dependentFiles[], routes[], models[], staticFindings[]}`
- `ReviewComment {file, line, severity, confidence, body, thread: Message[]}`
- `LlmProvider.complete(prompt) -> string` (pluggable, user-supplied key)
