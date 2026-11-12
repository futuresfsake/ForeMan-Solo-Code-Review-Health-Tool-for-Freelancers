import fs from "node:fs";
import path from "node:path";
import { detectFramework } from "../adapters/index.js";
import type { Config } from "../config.js";
import { writeInside } from "../fsafe.js";
import { isSourceFileName, loadProject, readPackageJson } from "../loader.js";
import { scanProject } from "../scan.js";
import type { Confidence, Severity } from "../types.js";
import { buildContext } from "./context.js";
import { createRedactor } from "./redact.js";
import { getDiff, parseDiff, ReviewError, renderNumbered, type DiffFile } from "./diff.js";
import { renderChangedFiles, replyMessages, reviewMessages } from "./prompt.js";
import type { LlmProvider } from "./provider.js";
import { printable } from "../text.js";

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
/**
 * The whole prompt, whatever it is made of. A prompt larger than the model's
 * context is cut silently by Ollama, and what it drops could be the scan's
 * facts or the question itself, so the prompt is cut here, visibly, instead.
 */
const MAX_PROMPT_CHARS = 26_000;
const MAX_FACTS = 30;
const MAX_PROMPT_ROUTES = 40;
const MAX_FACT_CHARS = 200;
const MAX_REVIEW_BYTES = 1024 * 1024;

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
    const body = printable(o.body);
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

  // What goes to the model is a capped copy; `context` keeps the full lists for the checks below.
  const facts = [...context.staticFindings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const sent = {
    ...context,
    changed: [...context.changed],
    related: [...context.related],
    routes: context.routes.slice(0, MAX_PROMPT_ROUTES),
    staticFindings: facts.slice(0, MAX_FACTS).map((f) => (f.message.length > MAX_FACT_CHARS ? { ...f, message: `${f.message.slice(0, MAX_FACT_CHARS - 1)}…` } : f)),
  };
  if (facts.length > MAX_FACTS) result.notes.push(`Only the ${MAX_FACTS} most serious of ${facts.length} scan findings in the changed files were sent to the model.`);
  if (context.routes.length > MAX_PROMPT_ROUTES) result.notes.push(`Only the first ${MAX_PROMPT_ROUTES} of ${context.routes.length} routes in the changed files were sent to the model.`);

  const build = () => reviewMessages(sent, renderChangedFiles(sent));
  const size = (m: { content: string }[]): number => m.reduce((n, x) => n + x.content.length, 0);
  let messages = build();
  const droppedRelated: string[] = [];
  while (size(messages) > MAX_PROMPT_CHARS && sent.related.length > 0) {
    droppedRelated.push(sent.related.pop()!.path);
    messages = build();
  }
  if (droppedRelated.length) result.notes.push(`Related files left out to keep the prompt inside the model's context: ${droppedRelated.join(", ")}.`);
  if (size(messages) > MAX_PROMPT_CHARS) {
    // Still too large: shorten the changed code itself, last file first, and say so.
    let over = size(messages) - MAX_PROMPT_CHARS;
    const cut: string[] = [];
    for (let i = sent.changed.length - 1; i >= 0 && over > 0; i--) {
      const file = sent.changed[i]!;
      const rows = [...file.rows];
      while (rows.length > 1 && over > 0) over -= renderNumbered({ ...file, rows: [rows.pop()!] }).length + 1;
      const kept = new Set(rows.filter((r) => r.kind === "+").map((r) => r.line));
      sent.changed[i] = { ...file, rows, added: file.added.filter((l) => kept.has(l)) };
      cut.push(file.path);
    }
    sent.changed = sent.changed.filter((c) => c.added.length > 0);
    messages = build();
    result.notes.push(`The end of the change in ${cut.reverse().join(", ")} was left out to keep the prompt inside the model's context. Review a smaller change for full coverage.`);
  }
  result.changedFiles = sent.changed.map((d) => d.path);
  if (sent.changed.length === 0 || size(messages) > MAX_PROMPT_CHARS) {
    throw new ReviewError("This change is too large to fit the model even after cutting. Review a smaller change, or pass --base closer to HEAD.");
  }

  if (options.dryRun) {
    result.promptPreview = messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
    return result;
  }
  const answer = await provider.complete(messages, { json: true });
  // Comments are tied to the lines the model was actually shown.
  const { comments, dropped } = normalizeComments(extractJson(answer), sent.changed);
  result.droppedInvalid = dropped;

  const reported = new Set(context.staticFindings.map((f) => `${f.file}:${f.line}`));
  const fresh = comments.filter((c) => !reported.has(`${c.file}:${c.line}`));
  result.hidden = comments.filter((c) => reported.has(`${c.file}:${c.line}`));

  fresh.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  result.comments = fresh.slice(0, MAX_COMMENTS).map((c, i) => ({ ...c, id: i + 1, thread: [] }));
  return result;
}

export function saveReview(root: string, result: ReviewResult): void {
  // Refuses to write through a link, so a project cannot aim this at another file.
  writeInside(path.resolve(root), REVIEW_FILE, `${JSON.stringify(result, null, 2)}\n`);
}

export function loadReview(root: string): ReviewResult {
  const file = path.join(path.resolve(root), REVIEW_FILE);
  try {
    if (fs.statSync(file).size > MAX_REVIEW_BYTES) throw new Error("too large");
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as ReviewResult;
    if (data?.kind !== "review" || !Array.isArray(data.comments)) throw new Error("bad shape");
    return data;
  } catch {
    throw new ReviewError("There is no saved review to reply to. Run `foreman-solo review` first.");
  }
}

/** The lines around a comment, read from the working tree and kept inside the project. */
function snippetFor(root: string, comment: ReviewComment): string {
  const base = path.resolve(root);
  const abs = path.resolve(base, String(comment.file));
  if (!abs.startsWith(base + path.sep)) throw new ReviewError("The saved review points outside the project.");
  // The saved review is a file in the project and may not be ours. Only source
  // code is ever sent: never a settings file such as .env, and never a link
  // that leads somewhere else.
  if (!isSourceFileName(path.basename(abs))) throw new ReviewError("The saved review points at a file that is not source code.");
  let lines: string[];
  try {
    if (fs.lstatSync(abs).isSymbolicLink() || !fs.realpathSync(abs).startsWith(fs.realpathSync(base) + path.sep)) {
      throw new ReviewError("The saved review points outside the project.");
    }
    lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  } catch (err) {
    if (err instanceof ReviewError) throw err;
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

  // The saved review is a file in the project, so nothing in it is taken on
  // trust: every field is cleaned and cut to length before it goes in a prompt.
  if (!Array.isArray(comment.thread)) comment.thread = [];
  const answer = await provider.complete(
    replyMessages({
      file: printable(comment.file).slice(0, 300),
      line: Number(comment.line) || 0,
      severity: severityOf(comment.severity),
      confidence: cap(comment.confidence),
      body: printable(comment.body).slice(0, MAX_BODY),
      thread: comment.thread.slice(-6).map((m) => ({ from: m?.from === "developer" ? ("developer" as const) : ("reviewer" as const), text: printable(m?.text).slice(0, MAX_BODY) })),
      snippet: snippetFor(root, comment),
      message: message.trim().slice(0, 2000),
    }),
    { json: true },
  );
  const parsed = extractJson(answer) as { stance?: unknown; reply?: unknown; severity?: unknown; confidence?: unknown };
  const reply = printable(parsed.reply);
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
