import fs from "node:fs";
import path from "node:path";
import { detectFramework, supportedLabels } from "./adapters/index.js";
import { DEFAULT_CONFIG, type Config } from "./config.js";
import { matchesPath } from "./glob.js";
import { loadProject, readPackageJson } from "./loader.js";
import { CATALOG } from "./rules/catalog.js";
import { npmrcNotes } from "./rules/deps.js";
import { RULES } from "./rules/index.js";
import { checklistItemsFor, computeScore, evaluateChecklist } from "./score.js";
import { clipped } from "./text.js";
import type { AuditRunner, Finding, ParsedFile, ProjectModel, RawFinding, ScanResult, Trend } from "./types.js";

const SEVERITY_ORDER = { blocker: 0, "should-fix": 1, "nice-to-have": 2 } as const;
const INLINE_IGNORE = /foreman-ignore\s+([a-z-]+\/[a-z-]+)\s*(?::\s*(.*?))?\s*(?:\*\/)?\s*$/;
/** A suppression comment is short. Longer lines are not searched: the pattern is slow on them. */
const MAX_IGNORE_LINE = 2000;

/** How the "not checked" reason of a rule that crashed starts. The CLI turns it into exit code 3. */
export const INTERNAL_ERROR = "internal error";

/** True when a rule failed while scanning, so the result is incomplete. */
export function ruleFailed(result: ScanResult): boolean {
  return result.coverage.rulesSkipped.some((s) => s.reason.startsWith(INTERNAL_ERROR));
}

/** Config keys that decide what is scanned, what counts as a finding and how it is scored. */
const SCAN_KEYS = ["ignorePaths", "failUnder", "audit", "sensitiveRoutes", "authMiddlewareNames", "weights", "confidenceFactor", "rules", "ignore", "checklist"] as const;

/**
 * Which of those keys differ from the defaults. A project you did not write
 * can ship a config that hides its own problems (ignored folders, rules turned
 * off, weights set to zero), so every report names what was changed.
 */
export function configChanges(config: Config): string[] {
  return SCAN_KEYS.filter((key) => JSON.stringify(config[key]) !== JSON.stringify(DEFAULT_CONFIG[key]));
}

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
    const line = lines[idx] ?? "";
    if (line.length > MAX_IGNORE_LINE) continue;
    const m = INLINE_IGNORE.exec(line);
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
  const adapter = detectFramework(loaded.files, packageJson);
  const warnings = [...loaded.warnings, ...adapter.warnings];

  const name =
    config.report.projectName ||
    (typeof packageJson?.name === "string" && packageJson.name) ||
    path.basename(absRoot);

  const model: ProjectModel = {
    root: absRoot,
    name,
    framework: adapter.framework,
    routes: adapter.routes,
    appMiddleware: adapter.appMiddleware,
    entry: adapter.entry,
    files: loaded.files,
    textFiles: loaded.textFiles,
    packageJson,
    config,
  };
  const hasRoutes = model.routes.length > 0;
  if (adapter.detected && !hasRoutes) {
    warnings.push(`${adapter.label} was detected but no routes were found; route checks did not run.`);
  }
  if (options.audit) warnings.push(...npmrcNotes(absRoot));

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
        skipped.set(id, adapter.detected ? "no routes found" : `needs a supported framework (${supportedLabels()})`);
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
      // The result is incomplete. It is still returned, with every affected
      // checklist item unverified, and the CLI exits with the internal-error code.
      for (const id of active) skipped.set(id, `${INTERNAL_ERROR}: ${(err as Error).message}`);
      warnings.push(`Rule group ${rule.ids[0]} failed and was skipped: ${(err as Error).message}. The result is incomplete.`);
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
    // File names, route paths and variable names come from the project. They
    // are cleaned here, once, so no report format can be driven by them.
    const finding: Finding = {
      ruleId: r.ruleId,
      severity: override && override !== "off" ? override : (r.severity ?? meta.severity),
      confidence: r.confidence ?? meta.confidence,
      file: clipped(r.file),
      line: r.line,
      message: clipped(r.message),
      risk: meta.risk,
      remediation: meta.remediation,
      checklistItems: checklistItemsFor(r.ruleId),
    };
    const configIgnore = config.ignore.find((i) => i.ruleId === r.ruleId && (!i.file || matchesPath(i.file, r.file)));
    const reason = configIgnore?.reason ?? inlineSuppression(byPath.get(r.file), r, warnings);
    if (reason) finding.suppressed = { reason: clipped(reason) || "(no readable reason)" };
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

  const checklist = evaluateChecklist(findings, config, ran, hasRoutes, loaded.filesNotAnalysed).map((c) => (c.note ? { ...c, note: clipped(c.note) } : c));
  const trend: Trend = "none";

  return {
    schemaVersion: 1,
    tool: "foreman-solo",
    toolVersion: options.toolVersion ?? toolVersion(),
    scannedAt: (options.now ?? new Date()).toISOString(),
    project: { name: clipped(name, 120) || "project", framework: model.framework },
    score: computeScore(findings, config),
    trend,
    readyToShip: checklist.every((c) => c.status === "pass"),
    checklist,
    findings,
    coverage: {
      filesScanned: loaded.files.length,
      filesWithSyntaxErrors: loaded.filesWithSyntaxErrors,
      filesNotAnalysed: loaded.filesNotAnalysed,
      routesFound: model.routes.length,
      rulesRun: [...ran].sort(),
      rulesSkipped: [...skipped].map(([id, reason]) => ({ id, reason: clipped(reason, 300) })).sort((a, b) => a.id.localeCompare(b.id)),
      configChanges: configChanges(config),
    },
    warnings: warnings.map((w) => clipped(w, 600)),
  };
}
