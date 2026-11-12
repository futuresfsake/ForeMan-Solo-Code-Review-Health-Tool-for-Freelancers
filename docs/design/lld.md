# Low-level design

Contracts below are stable once released (NFR-10). TypeScript notation. This page describes what is implemented unless a line says "planned".

## Source layout

| Path | Responsibility |
|---|---|
| `src/bin.ts` | Executable entry; sets the exit code |
| `src/cli.ts` | Flags, orchestration, exit codes; `main(argv, io)` is testable without spawning |
| `src/config.ts` | Defaults, loading and validation of `foreman.config.json` |
| `src/loader.ts` | Walks the project, applies ignores, parses each file |
| `src/adapters/express.ts` | Express routes, mounts and middleware into a normalized model |
| `src/adapters/nestjs.ts` | NestJS controllers, guards and global setup into the same model |
| `src/adapters/index.ts` | Adapter list; the first adapter that recognizes the project is used |
| `src/rules/catalog.ts` | Every rule ID with severity, confidence and fix text |
| `src/rules/*.ts` | Rule groups: secrets, injection, routes (auth, validation, rate limit), config, deps |
| `src/scan.ts` | Runs rules, applies suppressions and overrides, builds the result |
| `src/score.ts` | Score formula and go-live checklist |
| `src/history.ts` | `.foreman/history.json` and trend |
| `src/init.ts` | Starter config, git-ignore entries and the sample workflow |
| `src/report/client.ts` | Plain-English client summary |
| `src/report/brand.ts` | Loads the logo and accent colour for the client report |
| `src/llm/provider.ts` | `LlmProvider` interface and the Ollama provider (local endpoints only) |
| `src/llm/diff.ts` | Runs `git diff`, parses it, numbers new-file lines |
| `src/llm/context.ts` | Context builder: files the change imports, files that import it, routes, scan findings |
| `src/llm/redact.ts` | Masks secrets before anything goes into a prompt |
| `src/llm/prompt.ts` | The review and reply prompts |
| `src/llm/review.ts` | Runs a review, validates the model's answer, replies, saves `.foreman/review.json` |
| `src/llm/render.ts` | Terminal output for a review |
| `src/report/text.ts`, `html.ts` | Terminal, Markdown, summary table and HTML output |

## CLI

```
foreman-solo scan [path]      default path = .
  --all <paths...>            scan many project folders, print a summary table
  --report <html|md|client>   also write a report file; client = plain-English summary
  --out <dir>                 report folder (default ./foreman-report)
  --format <text|json>        what to print (default text)
  --context <file>            project context file (reserved)
  --fail-under <0-100>        exit 1 if the score is below this
  --config <file>             default: foreman.config.json in the project
  --no-audit                  skip npm audit (offline)
  --no-history                do not write .foreman/history.json

foreman-solo init [path]      write foreman.config.json and git-ignore .foreman/ and foreman-report/
  --ci                        also write .github/workflows/foreman-solo.yml (scan on push and weekly)

foreman-solo review [path]    experimental; asks a local model to review the current git diff
  --base <ref>                compare against this branch, tag or commit (default HEAD)
  --model <name>              Ollama model (default: llm.model in the config)
  --format <text|json>        what to print (default text)
  --dry-run                   print exactly what would be sent to the model, send nothing
  --reply <n> --message <t>   answer back to comment n of the last review
  --config <file>             default: foreman.config.json in the project
  --no-history                do not save the review to .foreman/review.json

planned: foreman-solo explain (M9)
```

With `--all`, a pattern such as `./clients/*` is expanded by the tool itself, so it works the same in every shell. Reports go to `<out>/<project>/report.html` plus `<out>/summary.html`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Scan ok, no open blockers, score at or above the threshold |
| 1 | Open blockers, or score below `--fail-under` (any project, with `--all`) |
| 2 | Usage or config error |
| 3 | Internal error |

## Core types

```ts
type Severity = "blocker" | "should-fix" | "nice-to-have";
type Confidence = "high" | "medium" | "low";

interface Finding {
  ruleId: string;            // "secrets/hardcoded-api-key"
  severity: Severity;
  confidence: Confidence;
  file: string;              // project-relative, forward slashes
  line: number;
  message: string;           // secrets are redacted
  risk: string;              // business consequence in plain English
  remediation: string;
  checklistItems: string[];  // ids from the checklist below
  suppressed?: { reason: string };
}

interface RouteInfo {
  method: string; path: string; file: string; line: number;
  params: string[];
  middleware: string[];      // mount-level, router-level, then route-level
  handler?: ts.Node;         // inline or same-file function, when found
  handlerRef: string;
}

interface ProjectModel {
  root: string; name: string;
  framework: "express" | "nestjs" | "unknown";
  routes: RouteInfo[];
  appMiddleware: string[];
  entry?: { file: string; line: number };
  files: ParsedFile[]; textFiles: TextFile[];
  packageJson: Record<string, unknown> | null;
  config: Config;
}

interface Rule {
  ids: string[];             // every rule ID this group can emit
  needsRoutes?: boolean;     // skipped (and reported as skipped) when no routes were found
  run(model: ProjectModel, ctx: RuleContext): RawFinding[];
}
```

Rules are pure functions of the model. They never touch the network; the dependency audit is injected through `RuleContext.audit` so tests can replace it.

## Express adapter

- Receivers: variables assigned from `express()` (app) or `Router()` / `express.Router()` (router). Conventional names (`app`, `router`, `*Router`, `*Routes`) are accepted as a fallback only when the path is a string starting with `/`.
- Routes: `X.get('/p', ...mw, handler)` and `X.route('/p').get(h).post(h)`.
- Mounts: `app.use('/prefix', mw, router)` is resolved across files through relative `import` / `require`. A file counts as a router only if it declares routes or `use()` calls, so imported middleware is not mistaken for a mount.
- Also resolved: chained calls (`Router().use(a).use('/api', b)`), a router mounted on another router in the same file, and routers mounted in a loop over a table of `{ path, route }` objects.
- Middleware order: a path-less `use()` applies to routes registered after it on the same receiver. A path-scoped `use('/admin', mw)` applies to routes under that path.
- Not resolved: dynamic paths, other loop styles, mounts through non-relative imports. These produce a warning or are simply not seen (see known-gaps.md).

## NestJS adapter

- Detected from `@nestjs/core` or `@nestjs/common` in `package.json` or in an import. Checked before Express, because Nest usually runs on Express underneath.
- Routes: methods decorated with `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@All`, `@Head` or `@Options` inside a `@Controller('prefix')` class. Paths are `setGlobalPrefix` + controller prefix + method path. `@Controller({ path })` and the first entry of an array path are read.
- Middleware: arguments of `@UseGuards`, `@UsePipes` and `@UseInterceptors` on the class, then the method; `@Auth`, `@Roles`, `@Permissions` and `@Throttle` count by name. `AuthGuard('jwt')` is recorded as `AuthGuard:jwt`.
- App level: `app.use`, `app.useGlobalGuards/Pipes/Interceptors` on the `NestFactory.create` result, and `{ provide: APP_GUARD | APP_PIPE | APP_INTERCEPTOR, useClass }` providers.
- `route.handler` is left empty, so `validation/unvalidated-param` does not run on Nest routes (input comes through `@Body()` and `@Param()`, not `req`).
- Not resolved: dynamic paths (warned), `@Public()` opt-outs from a global guard, URI versioning, modules registered with `RouterModule`.

## Rule catalog

| Rule ID | Default severity | Default confidence | Notes |
|---|---|---|---|
| secrets/hardcoded-api-key | blocker | high | Well-known key formats and private key blocks, in source and JSON/YAML |
| secrets/hardcoded-password | blocker | medium | Secret-like names assigned a literal, including `process.env.X \|\| "literal"`. Letters-only values and values equal to their own name are skipped unless they are an env fallback |
| secrets/committed-env | blocker | high (medium if only un-ignored) | `.env*` tracked by git or not git-ignored; example files excluded |
| injection/sql-concat | blocker | high with request data, else medium | Concatenation or template interpolation into a query call |
| injection/code-eval | blocker | high with request data, else medium | `eval` or `new Function` on a non-literal value |
| validation/unvalidated-param | should-fix | medium for body and query, low for path parameters only | Handler reads request input with no validation in sight |
| auth/missing-on-sensitive-route | blocker (medium) for sensitive paths; should-fix (low) for other writes and for an open `POST /users` | | No auth middleware at route, router, mount or app level |
| config/debug-enabled | should-fix | high | Dev `start` script or hardcoded development env |
| config/no-https-redirect | should-fix | low | No HTTPS or HSTS evidence anywhere in the code |
| config/permissive-cors | should-fix | medium, high for explicit `*` | `cors()` with no options (once per file), `origin: '*'`, manual `*` header |
| config/default-credentials | blocker | high | Default passwords, env fallbacks to defaults, default connection strings |
| config/stack-trace-leak | should-fix | high | `err.stack` sent in a response |
| config/no-rate-limit-auth | should-fix | medium | POST auth-like routes with no limiter |
| deps/vulnerable | by npm audit level | high | critical/high = blocker, moderate = should-fix, low = nice-to-have |
| deps/no-lockfile | nice-to-have | high | Dependencies but no lockfile |

## Go-live checklist

| ID | Item | Fails on open findings from |
|---|---|---|
| GL-01 | Secrets removed from repo | secrets/*, config/default-credentials |
| GL-02 | Debug/dev mode off | config/debug-enabled |
| GL-03 | HTTPS enforced | config/no-https-redirect |
| GL-04 | Backups configured | nothing; cannot be checked from code |
| GL-05 | Error pages don't leak stack traces | config/stack-trace-leak |
| GL-06 | Admin/internal routes locked down | auth/missing-on-sensitive-route |
| GL-07 | Rate limiting on auth routes | config/no-rate-limit-auth |

States: `pass`, `fail`, `unverified`. An item is `unverified` when its rule could not run (no routes found, rule turned off) or it cannot be checked from code. An attestation in the config turns `unverified` into `pass` and is shown in the report; it never overrides `fail`. "Ready to ship" requires every item to be `pass`.

## Health score

```
penalty = sum(weight[severity] * confidenceFactor[confidence]) over open findings,
          counting at most the 3 largest penalties per rule
score   = clamp(round(100 - penalty), 0, 100)
```

Defaults: blocker 15, should-fix 5, nice-to-have 1; high 1.0, medium 0.6, low 0.3. Suppressed findings do not count.

## JSON output (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "tool": "foreman-solo",
  "toolVersion": "0.1.0",
  "scannedAt": "2026-11-11T00:00:00.000Z",
  "project": { "name": "acme-api", "framework": "express" },
  "score": 82,
  "trend": "up",
  "previousScan": { "scannedAt": "2026-11-04T00:00:00.000Z", "score": 75 },
  "readyToShip": false,
  "checklist": [{ "id": "GL-01", "title": "Secrets removed from repo", "status": "pass" }],
  "findings": [],
  "coverage": {
    "filesScanned": 0,
    "filesWithSyntaxErrors": 0,
    "routesFound": 0,
    "rulesRun": [],
    "rulesSkipped": [{ "id": "deps/vulnerable", "reason": "dependency audit disabled for this run" }]
  },
  "warnings": []
}
```

`trend` is `up`, `flat`, `down` or `none` (first scan). No absolute paths appear in the output. With `--all` the output is `{ "schemaVersion": 1, "projects": [...] }`.

## History

`.foreman/history.json` inside each scanned project: an array of `{ scannedAt, score, findingCount }`, capped at 200 entries. Nothing else is stored. Disable with `--no-history`.

## Suppression

Inline `// foreman-ignore <ruleId>: <reason>` on the finding's line or the line above, or config `ignore: [{ ruleId, file, reason }]`. A reason is mandatory. Suppressed findings stay in the report with their reason and do not affect the score or checklist.

## LLM review (M6, experimental)

Implemented as in ADR-0007. `scan`, the rules and the adapters never import `src/llm/` (a test enforces it).

```ts
interface LlmProvider { name: string; complete(messages: ChatMessage[], options?: { json?: boolean }): Promise<string> }

interface ReviewComment {
  id: number; file: string; line: number;
  severity: Severity;
  confidence: "medium" | "low";      // never "high": only the deterministic rules can be sure
  body: string;
  thread: { from: "developer" | "reviewer"; text: string }[];
  withdrawn?: boolean;
}
```

Flow: `git diff <base>` -> parse and number lines -> run the scan -> mask secrets -> build context (files the change imports, files that import it, routes in the changed files, open scan findings in them, within a character budget) -> prompt with the scan's findings as facts -> validate the answer. A comment is kept only if it names a changed file and a line; the line is moved to the nearest added line; severity falls back to `should-fix`; confidence is capped at `medium`. Comments on a line the scan already reported go to `hidden`. At most 8 comments are kept.

`--reply` sends the original comment, the code around it, the thread so far and the developer's message back to the model, which answers `maintain`, `revise` or `withdraw`. The exchange is stored on the comment. The review is saved to `.foreman/review.json`.

Review JSON: `{ schemaVersion: 1, tool, kind: "review", model, reviewedAt, base, changedFiles, skippedFiles, staticFindings, comments, hidden, droppedInvalid, notes }`.

Not implemented: hosted providers, `explain` (M9).

## Client report

`--report client` writes `client-report.html`: what was reviewed, findings grouped by topic with their plain-English risk, and the checklist in plain words. It contains no file paths, rule IDs, code or secrets, never states that the project is secure, and carries the disclaimer. Names come from `report.preparedBy` and `report.clientName`. Branding (FR-26) comes from `report.logo` and `report.accentColor`: `src/report/brand.ts` reads the logo file, checks its type and size (256 KB), and embeds it as a `data:` URI shown through an `<img>` tag, so the report stays one offline file and an SVG logo cannot run scripts. The accent colour is validated as `#rrggbb` by the config loader and used only for borders.
