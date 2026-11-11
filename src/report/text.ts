import type { Finding, ScanResult, Severity } from "../types.js";

export const DISCLAIMER =
  "Automated static review, not a security audit, penetration test or certification. " +
  "It reports what its rules found; it cannot prove that code is secure.";

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: "BLOCKER",
  "should-fix": "SHOULD-FIX",
  "nice-to-have": "NICE-TO-HAVE",
};

export const TREND_LABEL = { up: "up", down: "down", flat: "no change", none: "first scan" } as const;

export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  cyan(s: string): string;
}

const wrap = (open: number, close: number) => (s: string) => `\u001b[${open}m${s}\u001b[${close}m`;
export const COLOR: Style = { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39), green: wrap(32, 39), cyan: wrap(36, 39) };
const same = (s: string): string => s;
export const PLAIN: Style = { bold: same, dim: same, red: same, yellow: same, green: same, cyan: same };

export function open(result: ScanResult): Finding[] {
  return result.findings.filter((f) => !f.suppressed);
}

export function verdict(result: ScanResult): string {
  const failing = result.checklist.filter((c) => c.status === "fail").length;
  const unverified = result.checklist.filter((c) => c.status === "unverified").length;
  if (result.readyToShip) return "Go-live checklist: all items pass.";
  const parts = [failing ? `${failing} failing` : "", unverified ? `${unverified} unverified` : ""].filter(Boolean);
  return `Not ready to ship: ${parts.join(", ")} checklist item(s).`;
}

function scoreColor(score: number, s: Style): (text: string) => string {
  return score >= 80 ? s.green : score >= 50 ? s.yellow : s.red;
}

export function renderTerminal(result: ScanResult, s: Style): string {
  const out: string[] = [];
  const findings = open(result);
  const suppressed = result.findings.length - findings.length;
  const framework = { express: "Express", nestjs: "NestJS", unknown: "no supported framework detected" }[result.project.framework];

  out.push("", `${s.bold("Foreman Solo")}  ·  ${result.project.name}  ·  ${framework}`, "");
  const trend = result.previousScan ? `${TREND_LABEL[result.trend]}, was ${result.previousScan.score}` : TREND_LABEL.none;
  out.push(`Health score   ${scoreColor(result.score, s)(s.bold(`${result.score} / 100`))}   ${s.dim(`(${trend})`)}`, "");

  if (findings.length === 0) {
    out.push(s.green("No open findings."), "");
  } else {
    out.push(s.bold(`Findings (${findings.length})`));
    for (const f of findings) {
      const paint = f.severity === "blocker" ? s.red : f.severity === "should-fix" ? s.yellow : s.dim;
      const hedge = f.confidence === "high" ? "" : s.dim(f.confidence === "medium" ? "  [likely]" : "  [worth a second look]");
      out.push(`  ${paint(SEVERITY_LABEL[f.severity].padEnd(12))} ${f.ruleId}  ${s.cyan(`${f.file}:${f.line}`)}${hedge}`);
      out.push(`  ${" ".repeat(12)} ${f.message}`);
      out.push(s.dim(`  ${" ".repeat(12)} Why: ${f.risk}`));
      out.push(s.dim(`  ${" ".repeat(12)} Fix: ${f.remediation}`));
    }
    out.push("");
  }
  if (suppressed > 0) out.push(s.dim(`${suppressed} finding(s) suppressed with a reason (listed in the report).`), "");

  out.push(s.bold("Go-live checklist"));
  for (const c of result.checklist) {
    const mark = c.status === "pass" ? s.green("[x]") : c.status === "fail" ? s.red("[ ]") : s.yellow("[?]");
    out.push(`  ${mark} ${c.id}  ${c.title}${c.note ? s.dim(`  (${c.note})`) : ""}`);
  }
  out.push("", result.readyToShip ? s.green(verdict(result)) : s.yellow(verdict(result)), "");

  const cov = result.coverage;
  out.push(s.dim(`Checked ${cov.filesScanned} file(s), ${cov.routesFound} route(s), ${cov.rulesRun.length} rule(s).`));
  for (const skip of cov.rulesSkipped) out.push(s.dim(`Not checked: ${skip.id} (${skip.reason}).`));
  for (const w of result.warnings) out.push(s.yellow(`Warning: ${w}`));
  out.push("", s.dim(DISCLAIMER), "");
  return out.join("\n");
}

export interface SummaryRow {
  result: ScanResult;
  dir: string;
}

export function renderSummaryTable(rows: SummaryRow[], s: Style): string {
  const header = ["Project", "Score", "Trend", "Blockers", "Ready", "Previous scan"];
  const body = rows.map(({ result }) => [
    result.project.name,
    String(result.score),
    TREND_LABEL[result.trend],
    String(open(result).filter((f) => f.severity === "blocker").length),
    result.readyToShip ? "yes" : "no",
    result.previousScan ? result.previousScan.scannedAt.slice(0, 10) : "never",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i]!.length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return ["", s.bold(line(header)), s.dim(widths.map((w) => "-".repeat(w)).join("  ")), ...body.map(line), "", s.dim(DISCLAIMER), ""].join("\n");
}

export function renderMarkdown(result: ScanResult): string {
  const findings = open(result);
  const suppressed = result.findings.filter((f) => f.suppressed);
  const cell = (t: string): string => t.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const out: string[] = [
    `# Code health report: ${result.project.name}`,
    "",
    `Scanned ${result.scannedAt.slice(0, 10)} with Foreman Solo ${result.toolVersion}.`,
    "",
    `**Health score: ${result.score} / 100.** ${verdict(result)}`,
    "",
    "## Go-live checklist",
    "",
    "| Item | Status | Note |",
    "|---|---|---|",
    ...result.checklist.map((c) => `| ${c.id} ${cell(c.title)} | ${c.status} | ${cell(c.note ?? "")} |`),
    "",
    `## Findings (${findings.length})`,
    "",
  ];
  if (findings.length === 0) out.push("No open findings.", "");
  else {
    out.push("| Severity | Confidence | Rule | Location | What | Why it matters | Fix |", "|---|---|---|---|---|---|---|");
    for (const f of findings) {
      out.push(`| ${SEVERITY_LABEL[f.severity]} | ${f.confidence} | ${f.ruleId} | ${cell(f.file)}:${f.line} | ${cell(f.message)} | ${cell(f.risk)} | ${cell(f.remediation)} |`);
    }
    out.push("");
  }
  if (suppressed.length > 0) {
    out.push(`## Suppressed (${suppressed.length})`, "", "| Rule | Location | Reason |", "|---|---|---|");
    for (const f of suppressed) out.push(`| ${f.ruleId} | ${cell(f.file)}:${f.line} | ${cell(f.suppressed!.reason)} |`);
    out.push("");
  }
  out.push("## What was checked", "", `${result.coverage.filesScanned} file(s), ${result.coverage.routesFound} route(s). Rules run: ${result.coverage.rulesRun.join(", ") || "none"}.`, "");
  for (const skip of result.coverage.rulesSkipped) out.push(`- Not checked: ${skip.id} (${skip.reason})`);
  for (const w of result.warnings) out.push(`- Warning: ${cell(w)}`);
  out.push("", `> ${DISCLAIMER}`, "");
  return out.join("\n");
}
