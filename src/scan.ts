import fs from "node:fs";
import path from "node:path";
import { buildExpressModel } from "./adapters/express.js";
import type { Config } from "./config.js";
import { matchesPath } from "./glob.js";
import { loadProject, readPackageJson } from "./loader.js";
import { CATALOG } from "./rules/catalog.js";
import { RULES } from "./rules/index.js";
import { checklistItemsFor, computeScore, evaluateChecklist } from "./score.js";
import type { AuditRunner, Finding, ParsedFile, ProjectModel, RawFinding, ScanResult, Trend } from "./types.js";

const SEVERITY_ORDER = { blocker: 0, "should-fix": 1, "nice-to-have": 2 } as const;
const INLINE_IGNORE = /foreman-ignore\s+([a-z-]+\/[a-z-]+)\s*(?::\s*(.*?))?\s*(?:\*\/)?\s*$/;

export interface ScanOptions {
  config: Config;
  /** Omit to skip the dependency audit. */
  audit?: AuditRunner;
  /** Injected for tests; defaults to the current time. */
  now?: Date;
  toolVersion?: string;
}

export function toolVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Reads `// foreman-ignore <ruleId>: <reason>` on the finding's line or the line above. */
function inlineSuppression(file: ParsedFile | undefined, finding: RawFinding, warnings: string[]): string | undefined {
  if (!file) return undefined;
  const lines = file.text.split(/\r?\n/);
  for (const idx of [finding.line - 1, finding.line - 2]) {
    const m = INLINE_IGNORE.exec(lines[idx] ?? "");
    if (!m || m[1] !== finding.ruleId) continue;
    const reason = (m[2] ?? "").trim();
    if (reason === "") {
      warnings.push(`${file.path}:${idx + 1}: foreman-ignore for ${finding.ruleId} has no reason, so it was not applied.`);
      return undefined;
    }
    return reason;
  }
  return undefined;
}

/** Runs the deterministic static pass on one project. Reads only; never executes project code. */
export function scanProject(root: string, options: ScanOptions): ScanResult {
  const { config } = options;
  const absRoot = path.resolve(root);
  const loaded = loadProject(absRoot, config.ignorePaths);
  const packageJson = readPackageJson(absRoot);
  const express = buildExpressModel(loaded.files, packageJson);
  const warnings = [...loaded.warnings, ...express.warnings];

  const name =
    config.report.projectName ||
    (typeof packageJson?.name === "string" && packageJson.name) ||
    path.basename(absRoot);

  const model: ProjectModel = {
    root: absRoot,
    name,
    framework: express.detected ? "express" : "unknown",
    routes: express.routes,
    appMiddleware: express.appMiddleware,
    entry: express.entry,
    files: loaded.files,
    textFiles: loaded.textFiles,
    packageJson,
    config,
  };
  const hasRoutes = model.routes.length > 0;
  if (express.detected && !hasRoutes) {
    warnings.push("Express was detected but no routes were found; route checks did not run.");
  }

  const skipped = new Map<string, string>();
  const ran = new Set<string>();
  const raw: RawFinding[] = [];

  for (const rule of RULES) {
    const active = rule.ids.filter((id) => {
      if (config.rules[id] === "off") {
        skipped.set(id, "turned off in config");
        return false;
      }
      if (rule.needsRoutes && !hasRoutes) {
        skipped.set(id, express.detected ? "no routes found" : "needs a supported framework (Express)");
        return false;
      }
      return true;
    });
    if (active.length === 0) continue;
    try {
      const found = rule.run(model, { config, audit: options.audit, skip: (id, reason) => skipped.set(id, reason) });
      raw.push(...found.filter((f) => active.includes(f.ruleId)));
      for (const id of active) if (!skipped.has(id)) ran.add(id);
    } catch (err) {
      for (const id of active) skipped.set(id, `internal error: ${(err as Error).message}`);
      warnings.push(`Rule group ${rule.ids[0]} failed and was skipped: ${(err as Error).message}`);
    }
  }

  const byPath = new Map(loaded.files.map((f) => [f.path, f]));
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const r of raw) {
    const key = `${r.ruleId}|${r.file}|${r.line}|${r.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = CATALOG[r.ruleId]!;
    const override = config.rules[r.ruleId];
    const finding: Finding = {
      ruleId: r.ruleId,
      severity: override && override !== "off" ? override : (r.severity ?? meta.severity),
      confidence: r.confidence ?? meta.confidence,
      file: r.file,
      line: r.line,
      message: r.message,
      remediation: meta.remediation,
      checklistItems: checklistItemsFor(r.ruleId),
    };
    const configIgnore = config.ignore.find((i) => i.ruleId === r.ruleId && (!i.file || matchesPath(i.file, r.file)));
    const reason = configIgnore?.reason ?? inlineSuppression(byPath.get(r.file), r, warnings);
    if (reason) finding.suppressed = { reason };
    findings.push(finding);
  }
  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.message.localeCompare(b.message),
  );

  const checklist = evaluateChecklist(findings, config, ran, hasRoutes);
  const trend: Trend = "none";

  return {
    schemaVersion: 1,
    tool: "foreman-solo",
    toolVersion: options.toolVersion ?? toolVersion(),
    scannedAt: (options.now ?? new Date()).toISOString(),
    project: { name, framework: model.framework },
    score: computeScore(findings, config),
    trend,
    readyToShip: checklist.every((c) => c.status === "pass"),
    checklist,
    findings,
    coverage: {
      filesScanned: loaded.files.length,
      filesWithSyntaxErrors: loaded.filesWithSyntaxErrors,
      routesFound: model.routes.length,
      rulesRun: [...ran].sort(),
      rulesSkipped: [...skipped].map(([id, reason]) => ({ id, reason })).sort((a, b) => a.id.localeCompare(b.id)),
    },
    warnings,
  };
}
