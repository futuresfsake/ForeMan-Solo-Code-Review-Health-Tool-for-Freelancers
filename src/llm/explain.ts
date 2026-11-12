import path from "node:path";
import { detectFramework } from "../adapters/index.js";
import type { Config } from "../config.js";
import { loadProject, readPackageJson } from "../loader.js";
import { scanProject } from "../scan.js";
import type { Severity } from "../types.js";
import { importsOf } from "./context.js";
import { ReviewError } from "./diff.js";
import { createRedactor } from "./redact.js";
import { explainMessages, type ExplainContext } from "./prompt.js";
import { extractJson } from "./review.js";
import type { LlmProvider } from "./provider.js";
import { printable } from "../text.js";

export interface ExplainArea {
  name: string;
  files: string[];
  what: string;
}

export interface ExplainRisk {
  file: string;
  severity: Severity;
  body: string;
}

export interface ExplainResult {
  schemaVersion: 1;
  tool: "foreman-solo";
  kind: "explain";
  model: string;
  explainedAt: string;
  project: string;
  framework: string;
  filesRead: string[];
  staticFindings: number;
  overview: string;
  areas: ExplainArea[];
  risks: ExplainRisk[];
  beforeYouStart: string[];
  notes: string[];
  /** Only with --dry-run: exactly what would be sent to the model. */
  promptPreview?: string;
}

export interface ExplainOptions {
  root: string;
  config: Config;
  provider: LlmProvider;
  now?: Date;
  dryRun?: boolean;
}

const SEVERITIES = new Set<string>(["blocker", "should-fix", "nice-to-have"]);
const MAX_FILES_LISTED = 60;
const MAX_ROUTES = 40;
const MAX_FINDINGS = 30;
const MAX_NAMES = 60;
/** The model has 8192 tokens for the prompt and its answer; code runs at about three characters a token. */
const MAX_PROMPT_CHARS = 20_000;
const MAX_SAMPLE_CHARS = 9_000;
const MAX_SAMPLE_FILE_CHARS = 1_800;
const MAX_ITEMS = 8;
const MAX_TEXT = 500;
const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, "should-fix": 1, "nice-to-have": 2 };
const BAD_FORMAT ="The model did not answer in the expected format. Try again, or set a different llm.model.";

function clip(value: unknown, max = MAX_TEXT): string {
  const s = printable(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Validates the model's answer; whatever is missing or malformed is dropped, never invented. */
export function normalizeExplain(raw: unknown, known: Set<string>): Pick<ExplainResult, "overview" | "areas" | "risks" | "beforeYouStart"> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ReviewError(BAD_FORMAT);
  const o = raw as Record<string, unknown>;
  const norm = (f: unknown): string => (typeof f === "string" ? f.replace(/^\.?\//, "").replace(/\\/g, "/") : "");
  const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

  const areas: ExplainArea[] = (Array.isArray(o.areas) ? o.areas : [])
    .map((a): ExplainArea => {
      const r = obj(a);
      return { name: clip(r.name, 80), files: (Array.isArray(r.files) ? r.files : []).map(norm).filter((f) => known.has(f)), what: clip(r.what) };
    })
    .filter((a) => a.name && a.what)
    .slice(0, MAX_ITEMS);

  const risks: ExplainRisk[] = (Array.isArray(o.risks) ? o.risks : [])
    .map((x): ExplainRisk => {
      const r = obj(x);
      return {
        file: norm(r.file),
        severity: typeof r.severity === "string" && SEVERITIES.has(r.severity) ? (r.severity as Severity) : "should-fix",
        body: clip(r.body),
      };
    })
    // A risk must point at a file that exists, or it cannot be checked.
    .filter((r) => r.body && known.has(r.file))
    .slice(0, MAX_ITEMS);

  const beforeYouStart = (Array.isArray(o.beforeYouStart) ? o.beforeYouStart : []).map((s) => clip(s, 300)).filter(Boolean).slice(0, MAX_ITEMS);
  const overview = clip(o.overview, 800);
  if (!overview && areas.length === 0) throw new ReviewError(BAD_FORMAT);
  return { overview, areas, risks, beforeYouStart };
}

/**
 * Explains an unfamiliar project (FR-28). The facts (framework, routes, scan
 * findings, dependency list) come from the deterministic scan; the model only
 * turns them and a sample of the code into a walkthrough. Secrets are masked
 * before anything is put in the prompt.
 */
export async function runExplain(options: ExplainOptions): Promise<ExplainResult> {
  const root = path.resolve(options.root);
  const { config, provider } = options;
  const loaded = loadProject(root, config.ignorePaths);
  const pkg = readPackageJson(root);
  const adapter = detectFramework(loaded.files, pkg);
  // No audit runner: explain never touches the network.
  const scan = scanProject(root, { config });

  const result: ExplainResult = {
    schemaVersion: 1,
    tool: "foreman-solo",
    kind: "explain",
    model: provider.name,
    explainedAt: (options.now ?? new Date()).toISOString(),
    project: scan.project.name,
    framework: String(scan.project.framework),
    filesRead: [],
    staticFindings: 0,
    overview: "",
    areas: [],
    risks: [],
    beforeYouStart: [],
    notes: [],
  };
  if (loaded.files.length === 0) {
    result.notes.push("No source files were found to explain.");
    return result;
  }

  const byPath = new Map(loaded.files.map((f) => [f.path, f]));
  const known = new Set(byPath.keys());
  const importedBy = new Map<string, number>();
  for (const f of loaded.files) for (const p of importsOf(f, known)) importedBy.set(p, (importedBy.get(p) ?? 0) + 1);
  const routeFiles = new Set(adapter.routes.map((r) => r.file));
  const rank = (p: string): number => (p === adapter.entry?.file ? 1_000 : 0) + (routeFiles.has(p) ? 100 : 0) + (importedBy.get(p) ?? 0);
  const ordered = [...known].sort((a, b) => rank(b) - rank(a) || a.localeCompare(b));

  const flagged = new Map<string, Set<number>>();
  for (const f of scan.findings) {
    if (f.ruleId !== "secrets/hardcoded-api-key" && f.ruleId !== "secrets/hardcoded-password") continue;
    flagged.set(f.file, (flagged.get(f.file) ?? new Set<number>()).add(f.line));
  }
  const mask = createRedactor();
  const samples: ExplainContext["samples"] = [];
  let used = 0;
  for (const p of ordered) {
    const text = byPath.get(p)!.text;
    const size = Math.min(text.length, MAX_SAMPLE_FILE_CHARS);
    if (samples.length > 0 && used + size > MAX_SAMPLE_CHARS) continue;
    mask.reset();
    used += size;
    samples.push({ path: p, text: mask.text(text.slice(0, MAX_SAMPLE_FILE_CHARS), flagged.get(p) ?? new Set<number>()), truncated: text.length > MAX_SAMPLE_FILE_CHARS });
  }
  const scripts = typeof pkg?.scripts === "object" && pkg.scripts !== null ? Object.keys(pkg.scripts) : [];
  const deps = typeof pkg?.dependencies === "object" && pkg.dependencies !== null ? Object.keys(pkg.dependencies) : [];
  // Blockers first, so that if the list is cut it is the least serious findings that go.
  const findings = scan.findings.filter((f) => !f.suppressed).sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  result.staticFindings = findings.length;

  // Everything is capped: a prompt larger than the model's context is cut
  // silently by Ollama, and what it drops could be the scan's facts.
  const ctx: ExplainContext = {
    name: result.project,
    framework: result.framework,
    scripts: scripts.slice(0, MAX_NAMES),
    dependencies: deps.slice(0, MAX_NAMES),
    files: [...known].sort().slice(0, MAX_FILES_LISTED),
    moreFiles: Math.max(0, known.size - MAX_FILES_LISTED),
    routes: adapter.routes.slice(0, MAX_ROUTES).map((r) => ({ method: r.method, path: r.path, file: r.file, line: r.line, middleware: r.middleware })),
    moreRoutes: Math.max(0, adapter.routes.length - MAX_ROUTES),
    findings: findings.slice(0, MAX_FINDINGS).map((f) => ({
      ruleId: f.ruleId,
      file: f.file,
      line: f.line,
      severity: f.severity,
      message: f.ruleId.startsWith("secrets/") ? "a secret value is hardcoded here (value withheld)" : f.message,
    })),
    moreFindings: Math.max(0, findings.length - MAX_FINDINGS),
    samples,
  };
  const size = (m: { content: string }[]): number => m.reduce((n, x) => n + x.content.length, 0);
  let messages = explainMessages(ctx);
  while (size(messages) > MAX_PROMPT_CHARS && samples.length > 1) {
    samples.pop();
    messages = explainMessages(ctx);
  }
  if (size(messages) > MAX_PROMPT_CHARS) {
    // Still too large with one file left: shorten that file rather than lose the facts above it.
    const over = size(messages) - MAX_PROMPT_CHARS;
    const only = samples[0]!;
    only.text = only.text.slice(0, Math.max(0, only.text.length - over));
    only.truncated = true;
    messages = explainMessages(ctx);
  }

  result.filesRead = samples.map((s) => s.path);
  if (samples.length < known.size) result.notes.push(`Read ${samples.length} of ${known.size} source files (the most connected ones); the rest are listed by name only.`);
  if (ctx.moreRoutes > 0) result.notes.push(`Only the first ${MAX_ROUTES} of ${adapter.routes.length} routes were sent to the model.`);
  if (ctx.moreFindings > 0) result.notes.push(`Only the ${MAX_FINDINGS} most serious of ${findings.length} scan findings were sent to the model.`);
  if (mask.count > 0) result.notes.push(`${mask.count} secret-like value(s) were masked before anything was sent to the model.`);

  if (options.dryRun) {
    result.promptPreview = messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
    return result;
  }
  const answer = await provider.complete(messages, { json: true });
  Object.assign(result, normalizeExplain(extractJson(answer), known));
  return result;
}
