import { SEVERITY_LABEL, type Style } from "../report/text.js";
import type { ExplainResult } from "./explain.js";
import type { ReviewComment, ReviewResult } from "./review.js";

export const REVIEW_NOTICE =
  "Machine-generated review from a small local model. It can be wrong and it misses things. " +
  "Treat it as a second opinion; the static scan is the part to rely on.";

function hedge(confidence: ReviewComment["confidence"]): string {
  return confidence === "medium" ? "[likely]" : "[worth a second look]";
}

export function renderComment(c: ReviewComment, s: Style): string[] {
  const paint = c.severity === "blocker" ? s.red : c.severity === "should-fix" ? s.yellow : s.dim;
  const status = c.withdrawn ? s.dim("  (withdrawn after discussion)") : "";
  const out = [`  ${s.bold(`#${c.id}`)} ${paint(SEVERITY_LABEL[c.severity].padEnd(12))} ${s.cyan(`${c.file}:${c.line}`)}  ${s.dim(hedge(c.confidence))}${status}`];
  out.push(`      ${c.body}`);
  for (const m of c.thread) out.push(s.dim(`      ${m.from === "developer" ? "you" : "reviewer"}: ${m.text}`));
  return out;
}

export function renderReview(result: ReviewResult, s: Style): string {
  const out: string[] = ["", `${s.bold("Foreman Solo review")}  ·  model ${result.model}  ·  against ${result.base}`, ""];
  if (result.changedFiles.length) out.push(`Reviewed ${result.changedFiles.length} changed file(s): ${result.changedFiles.join(", ")}`);
  if (result.skippedFiles.length) out.push(s.dim(`Not sent (not source code, or ignored): ${result.skippedFiles.join(", ")}`));
  out.push("");

  if (result.changedFiles.length === 0) {
    for (const n of result.notes) out.push(n);
    out.push("");
    return out.join("\n");
  }

  if (result.comments.length === 0) {
    out.push(s.green("The model had no new comments."), "");
  } else {
    out.push(s.bold(`Comments (${result.comments.length})`));
    for (const c of result.comments) out.push(...renderComment(c, s), "");
    out.push(s.dim("Disagree? Reply with: foreman-solo review --reply <number> --message \"<why>\""), "");
  }
  if (result.hidden.length) out.push(s.dim(`${result.hidden.length} comment(s) were on lines the scan already reported and are not shown (see them with --format json).`));
  if (result.droppedInvalid) out.push(s.dim(`${result.droppedInvalid} comment(s) could not be tied to a changed line and were dropped.`));
  for (const n of result.notes) out.push(s.dim(n));
  out.push("", s.dim(REVIEW_NOTICE), "");
  return out.join("\n");
}

export const EXPLAIN_NOTICE =
  "Machine-generated walkthrough from a small local model, based on a sample of the code. It can be wrong and it misses things. " +
  "Check it against the code; the static scan is the part to rely on.";

export function renderExplain(r: ExplainResult, s: Style): string {
  const out: string[] = ["", `${s.bold("Foreman Solo explain")}  ·  ${r.project} (${r.framework})  ·  model ${r.model}`, ""];
  if (r.filesRead.length === 0) {
    for (const n of r.notes) out.push(n);
    out.push("");
    return out.join("\n");
  }
  if (r.overview) out.push(s.bold("What it is"), `  ${r.overview}`, "");
  if (r.areas.length) {
    out.push(s.bold("Walkthrough"));
    for (const a of r.areas) {
      out.push(`  ${s.cyan(a.name)}${a.files.length ? s.dim(`  (${a.files.join(", ")})`) : ""}`, `      ${a.what}`);
    }
    out.push("");
  }
  if (r.risks.length) {
    out.push(s.bold("Risky patterns"));
    for (const x of r.risks) {
      const paint = x.severity === "blocker" ? s.red : x.severity === "should-fix" ? s.yellow : s.dim;
      out.push(`  ${paint(SEVERITY_LABEL[x.severity].padEnd(12))} ${s.cyan(x.file)}`, `      ${x.body}`);
    }
    out.push("");
  }
  if (r.beforeYouStart.length) {
    out.push(s.bold("Before you start"));
    for (const b of r.beforeYouStart) out.push(`  - ${b}`);
    out.push("");
  }
  if (r.staticFindings) out.push(s.dim(`The static scan has ${r.staticFindings} open finding(s); run \`foreman-solo scan\` for the full list.`));
  for (const n of r.notes) out.push(s.dim(n));
  out.push("", s.dim(EXPLAIN_NOTICE), "");
  return out.join("\n");
}
