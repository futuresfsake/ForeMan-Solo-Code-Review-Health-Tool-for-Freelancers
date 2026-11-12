import fs from "node:fs";
import path from "node:path";
import { detectFramework } from "../adapters/index.js";
import type { Config } from "../config.js";
import { loadProject, readPackageJson } from "../loader.js";
import { scanProject } from "../scan.js";
import type { Confidence, Severity } from "../types.js";
import { buildContext } from "./context.js";
import { createRedactor } from "./redact.js";
import { getDiff, parseDiff, ReviewError, renderNumbered, type DiffFile } from "./diff.js";
import { renderChangedFiles, replyMessages, reviewMessages } from "./prompt.js";
import type { LlmProvider } from "./provider.js";

export { ReviewError } from "./diff.js";

export interface ThreadMessage {
  from: "developer" | "reviewer";
  text: string;
}

export interface ReviewComment {
  id: number;
  file: string;
  line: number;
  severity: Severity;
  /** Never "high": only the deterministic rules can be sure. */
  confidence: Exclude<Confidence, "high">;
  body: string;
  thread: ThreadMessage[];
  withdrawn?: boolean;
}

export interface ReviewResult {
  schemaVersion: 1;
  tool: "foreman-solo";
  kind: "review";
  model: string;
  reviewedAt: string;
  base: string;
  changedFiles: string[];
  /** Changed files that are not parsed source code (or are ignored), so they were not sent. */
  skippedFiles: string[];
  staticFindings: number;
  comments: ReviewComment[];
  /**
   * Model comments on a line the scanner already reported. They are left out of
   * the printed review as likely repeats, but kept here so nothing is silently lost.
   */
  hidden: Omit<ReviewComment, "id" | "thread">[];
  /** Model comments dropped because they were malformed or pointed at unchanged files. */
  droppedInvalid: number;
  notes: string[];
  /** Only with --dry-run: exactly what would be sent to the model. Never saved. */
  promptPreview?: string;
}

export interface ReviewOptions {
  root: string;
  base: string;
  config: Config;
  provider: LlmProvider;
  now?: Date;
  /** Build the prompt and stop: nothing is sent to the model. */
  dryRun?: boolean;
}

const SEVERITIES = new Set<string>(["blocker", "should-fix", "nice-to-have"]);
const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, "should-fix": 1, "nice-to-have": 2 };
const MAX_COMMENTS = 8;
const MAX_BODY = 600;
/** Roughly what fits in the model's context together with the answer. */
const MAX_DIFF_CHARS = 14_000;
const MAX_RELATED_CHARS = 9_000;
const MAX_RELATED_FILE_CHARS = 3_000;

export const REVIEW_FILE = path.join(".foreman", "review.json");

/** Machine-generated text is never "high" confidence. */
function cap(confidence: unknown): ReviewComment["confidence"] {
  return confidence === "high" || confidence === "medium" ? "medium" : "low";
}

function severityOf(value: unknown): Severity {
  return typeof value === "string" && SEVERITIES.has(value) ? (value as Severity) : "should-fix";
}

/** Pulls a JSON value out of a model answer, tolerating code fences and chatter around it. */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new ReviewError("The model did not answer in the expected format. Try again, or set a different llm.model.");
}

function nearest(lines: number[], target: number): number {
  return lines.reduce((best, l) => (Math.abs(l - target) < Math.abs(best - target) ? l : best), lines[0]!);
}

interface Normalized {
  comments: Omit<ReviewComment, "id" | "thread">[];
  dropped: number;
}

/** Validates what the model said. Anything that cannot be tied to a changed line is dropped. */
export function normalizeComments(raw: unknown, changed: DiffFile[]): Normalized {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { comments?: unknown })?.comments) ? (raw as { comments: unknown[] }).comments : null;
  if (!list) throw new ReviewError("The model did not answer in the expected format. Try again, or set a different llm.model.");

  const byPath = new Map(changed.map((c) => [c.path, c]));
  const out: Normalized["comments"] = [];
  let dropped = 0;
  for (const item of list) {
    const o = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const body = typeof o.body === "string" ? o.body.trim() : "";
    const line = typeof o.line === "number" && Number.isFinite(o.line) ? Math.round(o.line) : NaN;
    const file = typeof o.file === "string" ? o.file.replace(/^\.?\//, "").replace(/\\/g, "/") : changed.length === 1 ? changed[0]!.path : "";
    const target = byPath.get(file);
    if (!body || Number.isNaN(line) || line < 1 || !target) {
      dropped++;
      continue;
    }
    out.push({
      file: target.path,
      line: nearest(target.added, line),
      severity: severityOf(o.severity),
      confidence: cap(o.confidence),
      body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
    });
  }
  return { comments: out, dropped };
}

/**
 * Reviews the current change (FR-20..24). The deterministic scan runs first and
 * its findings are given to the model as facts. Nothing here runs unless the
 * user asked for a review; `scan` never reaches this module.
 */
export async function runReview(options: ReviewOptions): Promise<ReviewResult> {
  const root = path.resolve(options.root);
  const { config, provider } = options;
  const parsed = parseDiff(getDiff(root, options.base));

  const loaded = loadProject(root, config.ignorePaths);
  const known = new Set(loaded.files.map((f) => f.path));
  const sources = parsed.filter((d) => known.has(d.path));
  const skippedFiles = parsed.filter((d) => !known.has(d.path)).map((d) => d.path);

  const result: ReviewResult = {
    schemaVersion: 1,
    tool: "foreman-solo",
    kind: "review",
    model: provider.name,
    reviewedAt: (options.now ?? new Date()).toISOString(),
    base: options.base,
    changedFiles: [],
    skippedFiles,
    staticFindings: 0,
    comments: [],
    hidden: [],
    droppedInvalid: 0,
    notes: [],
  };
  if (sources.length === 0) {
    result.notes.push("No changed source files to review. Untracked (new, uncommitted) files are not part of a git diff; stage or commit them first.");
    return result;
  }

  // Keep the prompt inside the model's context: whole files first, in order, until the budget is used.
  const included: DiffFile[] = [];
  let used = 0;
  for (const d of sources) {
    const size = renderNumbered(d).length;
    if (included.length > 0 && used + size > MAX_DIFF_CHARS) {
      result.notes.push(`${d.path} was left out because the change is large. Review a smaller change or pass --base closer to HEAD.`);
      continue;
    }
    used += size;
    included.push(d);
  }
  result.changedFiles = included.map((d) => d.path);

  const adapter = detectFramework(loaded.files, readPackageJson(root));
  const scan = scanProject(root, { config });

  // Mask secrets before anything is put in a prompt (security-and-trust.md).
  const flagged = new Map<string, Set<number>>();
  for (const f of scan.findings) {
    if (f.ruleId !== "secrets/hardcoded-api-key" && f.ruleId !== "secrets/hardcoded-password") continue;
    flagged.set(f.file, (flagged.get(f.file) ?? new Set<number>()).add(f.line));
  }
  const mask = createRedactor();
  const safeDiffs: DiffFile[] = included.map((d) => {
    mask.reset();
    const lines = flagged.get(d.path);
    return {
      ...d,
      rows: d.rows.map((r) => (r.kind === "@" ? r : { ...r, text: mask.line(r.text, r.kind === "-" ? "guess" : lines?.has(r.line!) ? "flagged" : "clean") })),
    };
  });

  const context = buildContext({
    changed: safeDiffs,
    files: loaded.files,
    routes: adapter.routes,
    findings: scan.findings,
    maxRelatedChars: MAX_RELATED_CHARS,
    maxFileChars: MAX_RELATED_FILE_CHARS,
  });
  context.related = context.related.map((r) => ({ ...r, text: mask.text(r.text, flagged.get(r.path) ?? new Set<number>()) }));
  result.staticFindings = context.staticFindings.length;
  if (context.omitted.length) result.notes.push(`Related files left out to fit the model: ${context.omitted.join(", ")}.`);
  if (mask.count > 0) result.notes.push(`${mask.count} secret-like value(s) were masked before anything was sent to the model.`);

  const messages = reviewMessages(context, renderChangedFiles(context));
  if (options.dryRun) {
    result.promptPreview = messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
    return result;
  }
  const answer = await provider.complete(messages, { json: true });
  const { comments, dropped } = normalizeComments(extractJson(answer), included);
  result.droppedInvalid = dropped;

  const reported = new Set(context.staticFindings.map((f) => `${f.file}:${f.line}`));
  const fresh = comments.filter((c) => !reported.has(`${c.file}:${c.line}`));
  result.hidden = comments.filter((c) => reported.has(`${c.file}:${c.line}`));

  fresh.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  result.comments = fresh.slice(0, MAX_COMMENTS).map((c, i) => ({ ...c, id: i + 1, thread: [] }));
  return result;
}

export function saveReview(root: string, result: ReviewResult): void {
  const file = path.join(path.resolve(root), REVIEW_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
}

export function loadReview(root: string): ReviewResult {
  const file = path.join(path.resolve(root), REVIEW_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as ReviewResult;
    if (data?.kind !== "review" || !Array.isArray(data.comments)) throw new Error("bad shape");
    return data;
  } catch {
    throw new ReviewError("There is no saved review to reply to. Run `foreman-solo review` first.");
  }
}

/** The lines around a comment, read from the working tree and kept inside the project. */
function snippetFor(root: string, comment: ReviewComment): string {
  const abs = path.resolve(root, comment.file);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new ReviewError("The saved review points outside the project.");
  let lines: string[];
  try {
    lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  } catch {
    return "(the file could not be read)";
  }
  const from = Math.max(1, comment.line - 6);
  const to = Math.min(lines.length, comment.line + 6);
  const mask = createRedactor();
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`[L${n}] ${mask.line(lines[n - 1]!, "guess")}`);
  return out.join("\n");
}

/**
 * Sends the developer's pushback to the model and records the answer in the
 * comment's thread (FR-23). A withdrawn comment stays in the file, marked.
 */
export async function replyToComment(root: string, provider: LlmProvider, id: number, message: string): Promise<{ review: ReviewResult; comment: ReviewComment }> {
  const review = loadReview(root);
  const comment = review.comments.find((c) => c.id === id);
  if (!comment) throw new ReviewError(`There is no comment ${id} in the last review.`);
  if (message.trim() === "") throw new ReviewError("Write what you want to say with --message.");

  const answer = await provider.complete(
    replyMessages({ ...comment, snippet: snippetFor(root, comment), message: message.trim() }),
    { json: true },
  );
  const parsed = extractJson(answer) as { stance?: unknown; reply?: unknown; severity?: unknown; confidence?: unknown };
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  if (!reply) throw new ReviewError("The model did not give a reply. Try again.");

  comment.thread.push({ from: "developer", text: message.trim() }, { from: "reviewer", text: reply.slice(0, MAX_BODY) });
  if (parsed.stance === "withdraw") comment.withdrawn = true;
  if (parsed.stance === "revise") {
    if (typeof parsed.severity === "string" && SEVERITIES.has(parsed.severity)) comment.severity = parsed.severity as Severity;
    comment.confidence = cap(parsed.confidence);
  }
  saveReview(root, review);
  return { review, comment };
}
