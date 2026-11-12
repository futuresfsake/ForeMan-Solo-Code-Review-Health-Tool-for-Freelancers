import fs from "node:fs";
import path from "node:path";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { globToRegExp } from "./glob.js";
import { applyHistory } from "./history.js";
import { initProject } from "./init.js";
import { LlmError, createOllamaProvider, type LlmProvider } from "./llm/provider.js";
import { runExplain } from "./llm/explain.js";
import { renderComment, renderExplain, renderReview } from "./llm/render.js";
import { ReviewError, replyToComment, runReview, saveReview } from "./llm/review.js";
import { BrandError, loadBrand } from "./report/brand.js";
import { renderClientHtml } from "./report/client.js";
import { renderHtml, renderSummaryHtml } from "./report/html.js";
import { COLOR, PLAIN, open, renderMarkdown, renderSummaryTable, renderTerminal, type SummaryRow } from "./report/text.js";
import { runNpmAudit } from "./rules/deps.js";
import { scanProject, toolVersion } from "./scan.js";
import type { AuditRunner, ScanResult } from "./types.js";

export const EXIT = { ok: 0, failed: 1, usage: 2, internal: 3 } as const;

export interface Io {
  out(text: string): void;
  err(text: string): void;
  color: boolean;
  cwd: string;
  /** Replaced in tests so they never touch the network. */
  audit: AuditRunner;
  /** Builds the model for `review`. Replaced in tests with a fake. */
  llm?: (settings: Config["llm"]) => LlmProvider;
}

export function defaultIo(): Io {
  const noColor = "NO_COLOR" in process.env || "FOREMAN_NO_COLOR" in process.env;
  return {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
    color: Boolean(process.stdout.isTTY) && !noColor,
    cwd: process.cwd(),
    audit: runNpmAudit,
  };
}

interface ScanFlags {
  all?: string[];
  report?: ReportFormat;
  out?: string;
  format: "text" | "json";
  context?: string;
  failUnder?: number;
  config?: string;
  audit: boolean;
  history: boolean;
}

type ReportFormat = "html" | "md" | "client";
const REPORT_FILE: Record<ReportFormat, string> = { html: "report.html", md: "report.md", client: "client-report.html" };

class UsageError extends Error {}

function choice<T extends string>(allowed: readonly T[]) {
  return (value: string): T => {
    if (!allowed.includes(value as T)) throw new InvalidArgumentError(`Expected one of: ${allowed.join(", ")}.`);
    return value as T;
  };
}

function scoreArg(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new InvalidArgumentError("Expected a number from 0 to 100.");
  return n;
}

/** Expands `./clients/*` ourselves, since Windows shells do not. */
function expandProjects(patterns: string[], cwd: string): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    const abs = path.resolve(cwd, pattern);
    const base = path.basename(abs);
    if (!/[*?]/.test(base)) {
      dirs.add(abs);
      continue;
    }
    const parent = path.dirname(abs);
    const re = globToRegExp(base);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
      throw new UsageError(`Folder not found: ${path.dirname(pattern)}`);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && re.test(entry.name)) {
        dirs.add(path.join(parent, entry.name));
      }
    }
  }
  const list = [...dirs].sort();
  for (const dir of list) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UsageError(`Not a folder: ${dir}`);
  }
  if (list.length === 0) throw new UsageError("No project folders matched.");
  return list;
}

interface Scanned {
  root: string;
  result: ScanResult;
  config: Config;
  failUnder: number;
}

function scanOne(root: string, flags: ScanFlags, io: Io): Scanned {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`Not a folder: ${root}`);
  const config = loadConfig(root, flags.config ? path.resolve(io.cwd, flags.config) : undefined);
  const result = scanProject(root, { config, audit: flags.audit && config.audit.enabled ? io.audit : undefined });
  applyHistory(root, result, flags.history);
  return { root, result, config, failUnder: flags.failUnder ?? config.failUnder };
}

function failed(s: Scanned): boolean {
  return s.result.score < s.failUnder || open(s.result).some((f) => f.severity === "blocker");
}

function writeReport(dir: string, scanned: Scanned, format: ReportFormat): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, REPORT_FILE[format]);
  const { result, config } = scanned;
  const content =
    format === "html"
      ? renderHtml(result)
      : format === "md"
        ? renderMarkdown(result)
        : renderClientHtml(result, {
            preparedBy: config.report.preparedBy,
            clientName: config.report.clientName,
            brand: loadBrand(scanned.root, config.report),
          });
  fs.writeFileSync(file, content);
  return file;
}

function safeDirName(name: string, used: Set<string>): string {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "project";
  let candidate = base;
  for (let i = 2; used.has(candidate); i++) candidate = `${base}-${i}`;
  used.add(candidate);
  return candidate;
}

function runScan(target: string | undefined, flags: ScanFlags, io: Io): number {
  if (flags.all && target) throw new UsageError("Pass either a path or --all, not both.");
  if (flags.context) {
    try {
      fs.accessSync(path.resolve(io.cwd, flags.context), fs.constants.R_OK);
    } catch {
      throw new UsageError(`Context file not readable: ${flags.context}`);
    }
  }
  const style = io.color ? COLOR : PLAIN;

  if (!flags.all) {
    const root = path.resolve(io.cwd, target ?? ".");
    const scanned = scanOne(root, flags, io);
    const outDir = path.resolve(io.cwd, flags.out ?? scanned.config.report.outDir);
    const reportFile = flags.report ? writeReport(outDir, scanned, flags.report) : undefined;
    if (flags.format === "json") io.out(JSON.stringify(scanned.result, null, 2));
    else {
      io.out(renderTerminal(scanned.result, style));
      if (reportFile) io.out(`Report written to ${reportFile}\n`);
    }
    return failed(scanned) ? EXIT.failed : EXIT.ok;
  }

  const scans = expandProjects(flags.all, io.cwd).map((root) => scanOne(root, flags, io));
  const outDir = path.resolve(io.cwd, flags.out ?? "./foreman-report");
  const used = new Set<string>();
  const rows: SummaryRow[] = scans.map((s) => ({ result: s.result, dir: safeDirName(s.result.project.name, used) }));
  let summaryFile: string | undefined;
  if (flags.report) {
    rows.forEach((row, i) => writeReport(path.join(outDir, row.dir), scans[i]!, flags.report!));
    if (flags.report === "html") {
      summaryFile = path.join(outDir, "summary.html");
      fs.writeFileSync(summaryFile, renderSummaryHtml(rows, new Date().toISOString()));
    }
  }
  if (flags.format === "json") io.out(JSON.stringify({ schemaVersion: 1, projects: scans.map((s) => s.result) }, null, 2));
  else {
    io.out(renderSummaryTable(rows, style));
    if (flags.report) io.out(`Reports written to ${summaryFile ?? outDir}\n`);
  }
  return scans.some(failed) ? EXIT.failed : EXIT.ok;
}

interface ReviewFlags {
  base: string;
  model?: string;
  format: "text" | "json";
  reply?: number;
  message?: string;
  config?: string;
  history: boolean;
  dryRun?: boolean;
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("Expected a comment number such as 1.");
  return n;
}

/** The opt-in LLM layer. Nothing in `scan` calls this (ADR-0002, ADR-0007). */
async function runReviewCommand(target: string | undefined, flags: ReviewFlags, io: Io): Promise<number> {
  const root = path.resolve(io.cwd, target ?? ".");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`Not a folder: ${root}`);
  const config = loadConfig(root, flags.config ? path.resolve(io.cwd, flags.config) : undefined);
  if (flags.model) config.llm.model = flags.model;
  const provider = (io.llm ?? ((s) => createOllamaProvider({ endpoint: s.endpoint, model: s.model })))(config.llm);
  const style = io.color ? COLOR : PLAIN;

  if (flags.reply !== undefined) {
    if (!flags.message) throw new UsageError("Add what you want to say with --message.");
    const { comment } = await replyToComment(root, provider, flags.reply, flags.message);
    io.out(flags.format === "json" ? JSON.stringify(comment, null, 2) : ["", ...renderComment(comment, style), ""].join("\n"));
    return EXIT.ok;
  }
  if (flags.message) throw new UsageError("--message is used together with --reply.");

  const result = await runReview({ root, base: flags.base, config, provider, dryRun: flags.dryRun });
  if (result.promptPreview !== undefined) {
    io.out(`${result.promptPreview}\n\n--- Dry run: this is exactly what would be sent. Nothing was sent.${result.notes.length ? `\n${result.notes.join("\n")}` : ""}`);
    return EXIT.ok;
  }
  if (flags.history && result.comments.length > 0) saveReview(root, result);
  io.out(flags.format === "json" ? JSON.stringify(result, null, 2) : renderReview(result, style));
  return EXIT.ok;
}

interface ExplainFlags {
  model?: string;
  format: "text" | "json";
  config?: string;
  dryRun?: boolean;
}

/** Opt-in, like `review`: a plain-language walkthrough of an unfamiliar project (FR-28). */
async function runExplainCommand(target: string | undefined, flags: ExplainFlags, io: Io): Promise<number> {
  const root = path.resolve(io.cwd, target ?? ".");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`Not a folder: ${root}`);
  const config = loadConfig(root, flags.config ? path.resolve(io.cwd, flags.config) : undefined);
  if (flags.model) config.llm.model = flags.model;
  const provider = (io.llm ?? ((s) => createOllamaProvider({ endpoint: s.endpoint, model: s.model })))(config.llm);
  const result = await runExplain({ root, config, provider, dryRun: flags.dryRun });
  if (result.promptPreview !== undefined) {
    io.out(`${result.promptPreview}\n\n--- Dry run: this is exactly what would be sent. Nothing was sent.${result.notes.length ? `\n${result.notes.join("\n")}` : ""}`);
    return EXIT.ok;
  }
  io.out(flags.format === "json" ? JSON.stringify(result, null, 2) : renderExplain(result, io.color ? COLOR : PLAIN));
  return EXIT.ok;
}

/** Runs the CLI and returns the process exit code. Never calls process.exit. */
export async function main(argv: string[], io: Io = defaultIo()): Promise<number> {
  let code: number = EXIT.ok;
  const program = new Command();
  program
    .name("foreman-solo")
    .description("Code review and health scanning for freelance Node developers.")
    .version(toolVersion())
    .exitOverride()
    .configureOutput({ writeOut: (t) => io.out(t.trimEnd()), writeErr: (t) => io.err(t.trimEnd()) });

  program
    .command("scan")
    .description("Scan a Node project (default: the current folder) and print a health report.")
    .argument("[path]", "project folder to scan")
    .option("--all <paths...>", "scan several project folders and print one summary table")
    .option("--report <format>", "also write a report file: html, md, or client (plain-English summary)", choice(["html", "md", "client"] as const))
    .option("--out <dir>", "folder for report files (default: ./foreman-report)")
    .option("--format <format>", "what to print: text or json", choice(["text", "json"] as const), "text")
    .option("--context <file>", "project context file (reserved for later features)")
    .option("--fail-under <score>", "exit with code 1 if the score is below this", scoreArg)
    .option("--config <file>", "config file (default: foreman.config.json in the project)")
    .option("--no-audit", "skip the npm audit dependency check (works offline)")
    .option("--no-history", "do not write .foreman/history.json into the project")
    .action((target: string | undefined, flags: ScanFlags) => {
      code = runScan(target, flags, io);
    });

  program
    .command("init")
    .description("Add a starter config to a project and keep Foreman Solo's output out of git.")
    .argument("[path]", "project folder")
    .option("--ci", "also add a GitHub Actions workflow that scans on push and weekly")
    .action((target: string | undefined, flags: { ci?: boolean }) => {
      const root = path.resolve(io.cwd, target ?? ".");
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new UsageError(`Not a folder: ${root}`);
      const done = initProject(root, { ci: Boolean(flags.ci) });
      for (const f of done.created) io.out(`created  ${f}`);
      for (const f of done.skipped) io.out(`kept     ${f} (already exists)`);
      if (done.created.length === 0) io.out("Nothing to do.");
    });

  program
    .command("review")
    .description("Experimental: ask a local model to review your current changes. Optional; the scan never needs it.")
    .argument("[path]", "project folder (must be a git repository)")
    .option("--base <ref>", "compare against this branch, tag or commit", "HEAD")
    .option("--model <name>", "Ollama model to use (default: llm.model in the config)")
    .option("--format <format>", "what to print: text or json", choice(["text", "json"] as const), "text")
    .option("--reply <number>", "reply to a comment from the last review", positiveInt)
    .option("--message <text>", "what you want to say when replying")
    .option("--dry-run", "print exactly what would be sent to the model, and send nothing")
    .option("--config <file>", "config file (default: foreman.config.json in the project)")
    .option("--no-history", "do not save the review to .foreman/review.json")
    .action(async (target: string | undefined, flags: ReviewFlags) => {
      code = await runReviewCommand(target, flags, io);
    });

  program
    .command("explain")
    .description("Experimental: ask a local model to walk you through an unfamiliar project. Optional; the scan never needs it.")
    .argument("[path]", "project folder")
    .option("--model <name>", "Ollama model to use (default: llm.model in the config)")
    .option("--format <format>", "what to print: text or json", choice(["text", "json"] as const), "text")
    .option("--dry-run", "print exactly what would be sent to the model, and send nothing")
    .option("--config <file>", "config file (default: foreman.config.json in the project)")
    .action(async (target: string | undefined, flags: ExplainFlags) => {
      code = await runExplainCommand(target, flags, io);
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return code;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode === 0 ? EXIT.ok : EXIT.usage;
    if (err instanceof UsageError || err instanceof ConfigError || err instanceof BrandError || err instanceof ReviewError || err instanceof LlmError) {
      io.err(`Error: ${err.message}`);
      return EXIT.usage;
    }
    io.err(`Internal error: ${(err as Error).stack ?? String(err)}`);
    return EXIT.internal;
  }
}
