import { SEVERITY_LABEL, type Style } from "../report/text.js";
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
