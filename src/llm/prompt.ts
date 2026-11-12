import type { ChatMessage } from "./provider.js";
import type { ReviewContext } from "./context.js";
import { renderNumbered } from "./diff.js";

const PERSONA =
  "You are a careful senior code reviewer helping a freelance developer who has no other reviewer. " +
  "Be concrete and brief. Never invent code you cannot see. If you are not sure, say so and use low confidence.";

/** Stepwise review prompt (FR-21): the scanner's findings go in as facts, not as questions. */
export function reviewMessages(ctx: ReviewContext, renderedDiffs: string[]): ChatMessage[] {
  const facts = ctx.staticFindings.length
    ? ctx.staticFindings
        // The scan's own message for a secret shows its first characters; the model does not need them.
        .map((f) => `- ${f.ruleId} at ${f.file}:${f.line} (${f.severity}): ${f.ruleId.startsWith("secrets/") ? "a secret value is hardcoded here (value withheld)" : f.message}`)
        .join("\n")
    : "- none";
  const routes = ctx.routes.length
    ? ctx.routes.map((r) => `- ${r.method} ${r.path} (${r.file}:${r.line}) middleware: ${r.middleware.join(", ") || "none"}`).join("\n")
    : "- none found in the changed files";
  const related = ctx.related.length
    ? ctx.related.map((r) => `=== ${r.path} (${r.why}${r.truncated ? ", start of file only" : ""}) ===\n${r.text}`).join("\n\n")
    : "(none)";

  const user = `Review this change. Work through these steps, then answer:
1. What is the change trying to do?
2. What could a hostile or careless user send to it?
3. What is missing? Look especially for: checks that the logged-in user owns the record, limits on amounts and quantities (money, refunds, stock), error handling, work that should be in a transaction, validation of numbers.
4. Does it match how the neighbouring code does the same thing?

Facts from a deterministic scanner. They are true. Do not repeat or contradict them; only report NEW problems:
${facts}

Routes in the changed files:
${routes}

Changed code. Lines marked [L<n>] are line numbers in the new file; quote them. "+" is added, "-" is removed:
${renderedDiffs.join("\n\n")}

Related code, for context only:
${related}

Answer with JSON only, in this shape:
{"comments":[{"file":"<path as shown>","line":<number>,"severity":"blocker|should-fix|nice-to-have","confidence":"medium|low","body":"<what is wrong, why it matters, how to fix it, in two sentences>"}]}
Report at most 6 comments. If you find nothing new, answer {"comments":[]}.`;

  return [
    { role: "system", content: PERSONA },
    { role: "user", content: user },
  ];
}

export function renderChangedFiles(ctx: ReviewContext): string[] {
  return ctx.changed.map((c) => `=== ${c.path} ===\n${renderNumbered(c)}`);
}

export interface ReplyInput {
  file: string;
  line: number;
  severity: string;
  confidence: string;
  body: string;
  snippet: string;
  thread: { from: "developer" | "reviewer"; text: string }[];
  message: string;
}

/** Pushback round-trip (FR-23): the model must reconsider, not just agree. */
export function replyMessages(input: ReplyInput): ChatMessage[] {
  const thread = input.thread.length ? input.thread.map((m) => `${m.from}: ${m.text}`).join("\n") : "(no earlier replies)";
  const user = `You made this review comment.
Comment (${input.severity}, ${input.confidence} confidence) on ${input.file}:${input.line}:
${input.body}

The code around it:
${input.snippet}

Earlier replies:
${thread}

The developer now says:
${input.message}

Reconsider honestly. If the developer is right, withdraw the comment. If the concern still applies, keep it and explain why in plain words. Do not agree just to be agreeable, and do not repeat yourself.
Answer with JSON only: {"stance":"maintain|revise|withdraw","reply":"<one to three sentences>","severity":"blocker|should-fix|nice-to-have","confidence":"medium|low"}
Include severity and confidence only when stance is "revise".`;
  return [
    {
      role: "system",
      content: `${PERSONA} A developer is pushing back on one of your comments. You may be wrong, and so may they.`,
    },
    { role: "user", content: user },
  ];
}

export interface ExplainContext {
  name: string;
  framework: string;
  scripts: string[];
  dependencies: string[];
  files: string[];
  moreFiles: number;
  routes: { method: string; path: string; file: string; line: number; middleware: string[] }[];
  findings: { ruleId: string; file: string; line: number; severity: string; message: string }[];
  samples: { path: string; text: string; truncated: boolean }[];
}

/** Walkthrough prompt (FR-28): facts from the scan go in first, code samples last. */
export function explainMessages(ctx: ExplainContext): ChatMessage[] {
  const list = <T>(items: T[], f: (t: T) => string, none: string): string => (items.length ? items.map(f).join("\n") : none);
  const user = `A freelance developer was handed this project and has never seen it. Explain it so they can start work safely.

Project: ${ctx.name}
Framework detected by the scanner: ${ctx.framework}
npm scripts: ${ctx.scripts.join(", ") || "none"}
Dependencies: ${ctx.dependencies.join(", ") || "none"}

Source files${ctx.moreFiles ? ` (first ${ctx.files.length}, ${ctx.moreFiles} more not listed)` : ""}:
${ctx.files.map((f) => `- ${f}`).join("\n")}

Routes found by the scanner:
${list(ctx.routes, (r) => `- ${r.method} ${r.path} (${r.file}:${r.line}) middleware: ${r.middleware.join(", ") || "none"}`, "- none found")}

Facts from a deterministic scanner. They are true; build on them, do not contradict them:
${list(ctx.findings, (f) => `- ${f.ruleId} at ${f.file}:${f.line} (${f.severity}): ${f.message}`, "- none")}

Start of the most connected files:
${ctx.samples.map((s) => `=== ${s.path}${s.truncated ? " (start of file only)" : ""} ===\n${s.text}`).join("\n\n")}

Only describe what you can see above. Use only file paths from the lists above. Answer with JSON only, in this shape:
{"overview":"<what the app does, in plain words, 2-3 sentences>","areas":[{"name":"<short name>","files":["<path>"],"what":"<what this part does>"}],"risks":[{"file":"<path>","severity":"blocker|should-fix|nice-to-have","body":"<risky pattern and why it matters>"}],"beforeYouStart":["<a fix or check to do before changing anything>"]}
At most 6 areas, 6 risks and 6 beforeYouStart items. If you are unsure of something, leave it out.`;
  return [
    {
      role: "system",
      content: `${PERSONA} You are explaining a codebase you only partly see. Say so rather than guess.`,
    },
    { role: "user", content: user },
  ];
}
