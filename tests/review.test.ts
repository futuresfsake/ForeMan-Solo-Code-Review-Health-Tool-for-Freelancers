import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, main, type Io } from "../src/cli.js";
import { mergeConfig } from "../src/config.js";
import { parseDiff } from "../src/llm/diff.js";
import { LlmError, createOllamaProvider, type ChatMessage, type LlmProvider } from "../src/llm/provider.js";
import { REVIEW_NOTICE } from "../src/llm/render.js";
import { ReviewError, extractJson, loadReview, replyToComment, runReview, saveReview } from "../src/llm/review.js";
import { FAKE, PKG, project, tempDir } from "./helpers.js";

/** A model that returns canned answers and remembers every prompt it was sent. */
function fake(...answers: string[]): LlmProvider & { prompts: ChatMessage[][] } {
  const prompts: ChatMessage[][] = [];
  let i = 0;
  return {
    name: "fake-model",
    prompts,
    async complete(messages) {
      prompts.push(messages);
      return answers[Math.min(i++, answers.length - 1)]!;
    },
  };
}

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" });
}

const BEFORE = ["const express = require('express');", "const db = require('./db');", "const app = express();", "app.get('/health', (req, res) => res.end('ok'));", ""].join("\n");

const AFTER = [
  "const express = require('express');",
  "const db = require('./db');",
  "const app = express();",
  "app.get('/health', (req, res) => res.end('ok'));",
  "app.post('/orders/:id/refund', (req, res) => {",
  "  const order = db.query(\"SELECT * FROM orders WHERE id = \" + req.params.id);",
  "  payments.refund(order.paymentId, req.body.amount);",
  "  res.json({ ok: true });",
  "});",
  "",
].join("\n");

const SQL_LINE = 6;
const REFUND_LINE = 7;

/** A git repo with one commit, then an uncommitted change to app.js and .env. */
function changedRepo(): string {
  const dir = project({
    "package.json": PKG,
    "package-lock.json": "{}",
    "app.js": BEFORE,
    "db.js": "module.exports = { query() {} };\n",
    "server.js": "const app = require('./app');\napp.listen(3000);\n",
    ".env": "NAME=before\n",
  });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  fs.writeFileSync(path.join(dir, "app.js"), AFTER);
  fs.writeFileSync(path.join(dir, ".env"), "NAME=topsecretvalue\n");
  return dir;
}

const answer = (comments: unknown[]): string => JSON.stringify({ comments });

describe("diff parsing", () => {
  it("numbers added lines in the new file and skips deleted files", () => {
    const text = [
      "diff --git a/a.js b/a.js",
      "--- a/a.js",
      "+++ b/a.js",
      "@@ -1,3 +1,4 @@",
      " one",
      "-- not a header, a removed line",
      "+two",
      "+three",
      " four",
      "diff --git a/gone.js b/gone.js",
      "--- a/gone.js",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
    ].join("\n");
    const files = parseDiff(text);
    expect(files.map((f) => f.path)).toEqual(["a.js"]);
    expect(files[0]!.added).toEqual([2, 3]);
  });
});

describe("model output handling", () => {
  it("reads JSON from code fences and chatter, and rejects anything else", () => {
    expect(extractJson('```json\n{"comments":[]}\n```')).toEqual({ comments: [] });
    expect(extractJson('Sure! {"comments":[]} Hope that helps.')).toEqual({ comments: [] });
    expect(() => extractJson("no json here")).toThrow(ReviewError);
  });
});

describe("review (FR-20..24)", () => {
  it("gives the model the diff, related files, routes and the scan's findings, but not settings files", async () => {
    const dir = changedRepo();
    const model = fake(answer([]));
    await runReview({ root: dir, base: "HEAD", config: mergeConfig({}), provider: model });
    const prompt = model.prompts[0]!.map((m) => m.content).join("\n");
    expect(prompt).toContain(`[L${REFUND_LINE}]`);
    expect(prompt).toContain("=== db.js (imported by the change)");
    expect(prompt).toContain("=== server.js (imports the changed file)");
    expect(prompt).toContain("injection/sql-concat");
    expect(prompt).toContain("POST /orders/:id/refund");
    expect(prompt).not.toContain("topsecretvalue");
  });

  it("keeps comments tied to changed lines, never claims high confidence, and hides repeats of scan findings", async () => {
    const dir = changedRepo();
    const model = fake(
      answer([
        { file: "app.js", line: SQL_LINE, severity: "blocker", confidence: "high", body: "SQL injection." },
        { file: "app.js", line: 40, severity: "blocker", confidence: "high", body: "Refund amount is not checked against the order total." },
        { file: "./app.js", line: REFUND_LINE, severity: "bogus", confidence: "low", body: "No transaction around the refund." },
        { file: "other.js", line: 1, severity: "blocker", confidence: "high", body: "Unknown file." },
        { file: "app.js", line: 2, severity: "blocker", confidence: "high", body: "" },
      ]),
    );
    const result = await runReview({ root: dir, base: "HEAD", config: mergeConfig({}), provider: model });
    expect(result.skippedFiles).toEqual([".env"]);
    expect(result.hidden.map((c) => c.body)).toEqual(["SQL injection."]);
    expect(result.droppedInvalid).toBe(2);
    expect(result.comments.map((c) => [c.id, c.line, c.severity, c.confidence])).toEqual([
      [1, 9, "blocker", "medium"], // line 40 snapped to the nearest added line, "high" capped
      [2, REFUND_LINE, "should-fix", "low"], // unknown severity falls back
    ]);
    expect(result.comments.every((c) => c.confidence !== ("high" as string))).toBe(true);
  });

  describe("secrets never reach the prompt", () => {
    const awsKey = FAKE.aws;
    const pem = ["-----BEGIN " + "PRIVATE KEY-----", "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "-----END " + "PRIVATE KEY-----"];

    function secretRepo(): string {
      const dir = project({
        "package.json": PKG,
        "package-lock.json": "{}",
        "app.js": "const express = require('express');\nconst app = express();\n",
        "keys.js": `const unrelated = 1;\n${pem.join("\n")}\n`,
      });
      git(dir, "init", "-q");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "initial");
      fs.writeFileSync(
        path.join(dir, "app.js"),
        [
          "const express = require('express');",
          "const app = express();",
          'const dbPassword = "hunter2-prod-pass";',
          `const aws = "${awsKey}";`,
          "app.post('/pay', (req, res) => res.end());",
          "",
        ].join("\n"),
      );
      return dir;
    }

    it("masks hardcoded values, key formats and private key blocks, and says so", async () => {
      const dir = secretRepo();
      const model = fake(answer([]));
      const result = await runReview({ root: dir, base: "HEAD", config: mergeConfig({}), provider: model });
      const prompt = model.prompts[0]!.map((m) => m.content).join("\n");
      expect(prompt).not.toContain("hunter2-prod-pass");
      expect(prompt).not.toContain(awsKey);
      expect(prompt).not.toContain("hunt"); // the scan's own message shows four characters; it is withheld
      expect(prompt).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
      expect(prompt).toContain("value withheld");
      expect(prompt).toContain('const dbPassword = "[REDACTED]"');
      expect(result.notes.join(" ")).toMatch(/\d+ secret-like value\(s\) were masked/);
    });

    it("also masks a removed line and the code shown while replying", async () => {
      const dir = secretRepo();
      fs.writeFileSync(path.join(dir, "app.js"), "const express = require('express');\nconst app = express();\nconst apiToken = \"abcd1234efgh5678\";\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "token");
      fs.writeFileSync(path.join(dir, "app.js"), "const express = require('express');\nconst app = express();\nconst x = 1;\n");
      const model = fake(answer([{ file: "app.js", line: 3, severity: "should-fix", confidence: "low", body: "Check x." }]));
      const result = await runReview({ root: dir, base: "HEAD", config: mergeConfig({}), provider: model });
      const sent = model.prompts[0]!.map((m) => m.content).join("\n");
      expect(sent).toContain('apiToken = "[REDACTED]"'); // the removed line is in the diff, masked
      expect(sent).not.toContain("abcd1234efgh5678");
      saveReview(dir, result);
      fs.writeFileSync(path.join(dir, "app.js"), "const apiToken = \"abcd1234efgh5678\";\nconst x = 1;\n");
      const reply = fake(JSON.stringify({ stance: "maintain", reply: "Still." }));
      await replyToComment(dir, reply, 1, "why");
      expect(reply.prompts[0]!.map((m) => m.content).join("\n")).not.toContain("abcd1234efgh5678");
    });

    it("--dry-run prints the prompt and sends nothing", async () => {
      const dir = secretRepo();
      const model = fake(answer([]));
      const t = { stdout: [] as string[], errors: [] as string[] };
      const code = await main(["review", "--dry-run"], {
        out: (x) => t.stdout.push(x),
        err: (x) => t.errors.push(x),
        color: false,
        cwd: dir,
        audit: () => ({ ok: true, vulnerabilities: [] }),
        llm: () => model,
      });
      expect(code).toBe(EXIT.ok);
      expect(model.prompts).toHaveLength(0);
      const text = t.stdout.join("\n");
      expect(text).toContain("Nothing was sent");
      expect(text).toContain("[REDACTED]");
      expect(text).not.toContain("hunter2-prod-pass");
      expect(fs.existsSync(path.join(dir, ".foreman", "review.json"))).toBe(false);
    });
  });

  it("makes no model call when nothing reviewable changed", async () => {
    const dir = changedRepo();
    git(dir, "checkout", "--", "app.js");
    const model = fake(answer([]));
    const result = await runReview({ root: dir, base: "HEAD", config: mergeConfig({}), provider: model });
    expect(model.prompts).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("No changed source files");
  });

  it("fails clearly when the model does not return JSON, outside git, and for a bad ref", async () => {
    const dir = changedRepo();
    await expect(runReview({ root: dir, base: "HEAD", config: mergeConfig({}), provider: fake("I think it looks fine.") })).rejects.toThrow(/expected format/);
    await expect(runReview({ root: dir, base: "nope", config: mergeConfig({}), provider: fake("{}") })).rejects.toThrow(/does not know/);
    await expect(runReview({ root: dir, base: "--output=x", config: mergeConfig({}), provider: fake("{}") })).rejects.toThrow(/Not a valid git reference/);
    await expect(runReview({ root: tempDir(), base: "HEAD", config: mergeConfig({}), provider: fake("{}") })).rejects.toThrow(/not a git repository/);
  });
});

describe("pushback (FR-23)", () => {
  async function saved(): Promise<string> {
    const dir = changedRepo();
    const result = await runReview({
      root: dir,
      base: "HEAD",
      config: mergeConfig({}),
      provider: fake(answer([{ file: "app.js", line: REFUND_LINE, severity: "blocker", confidence: "medium", body: "Amount is not checked." }])),
    });
    saveReview(dir, result);
    return dir;
  }

  it("records the exchange, sends the code around the comment, and can withdraw a comment", async () => {
    const dir = await saved();
    const model = fake(JSON.stringify({ stance: "withdraw", reply: "Fair, the amount is checked upstream." }));
    const { comment } = await replyToComment(dir, model, 1, "Intentional: a middleware caps the amount.");
    expect(model.prompts[0]!.map((m) => m.content).join("\n")).toContain(`[L${REFUND_LINE}] `);
    expect(comment.withdrawn).toBe(true);
    expect(loadReview(dir).comments[0]!.thread.map((m) => m.from)).toEqual(["developer", "reviewer"]);
  });

  it("can hold its ground or lower its severity", async () => {
    const dir = await saved();
    const held = await replyToComment(dir, fake(JSON.stringify({ stance: "maintain", reply: "Still unchecked here." })), 1, "why?");
    expect(held.comment.withdrawn).toBeUndefined();
    expect(held.comment.severity).toBe("blocker");
    const revised = await replyToComment(dir, fake(JSON.stringify({ stance: "revise", reply: "Lower then.", severity: "should-fix", confidence: "high" })), 1, "it is internal");
    expect(revised.comment.severity).toBe("should-fix");
    expect(revised.comment.confidence).toBe("medium");
    expect(loadReview(dir).comments[0]!.thread).toHaveLength(4);
  });

  it("explains missing reviews and comment numbers, and keeps reads inside the project", async () => {
    await expect(replyToComment(changedRepo(), fake("{}"), 1, "hi")).rejects.toThrow(/no saved review/);
    const dir = await saved();
    await expect(replyToComment(dir, fake("{}"), 9, "hi")).rejects.toThrow(/no comment 9/);
    const review = loadReview(dir);
    review.comments[0]!.file = "../outside.js";
    saveReview(dir, review);
    await expect(replyToComment(dir, fake("{}"), 1, "hi")).rejects.toThrow(/outside the project/);
  });
});

describe("foreman-solo review", () => {
  function io(cwd: string, model: LlmProvider): Io & { stdout: string[]; errors: string[] } {
    const stdout: string[] = [];
    const errors: string[] = [];
    return { stdout, errors, out: (t) => stdout.push(t), err: (t) => errors.push(t), color: false, cwd, audit: () => ({ ok: true, vulnerabilities: [] }), llm: () => model };
  }

  it("prints comments with the machine-generated notice and saves them for replies", async () => {
    const dir = changedRepo();
    const t = io(dir, fake(answer([{ file: "app.js", line: REFUND_LINE, severity: "blocker", confidence: "medium", body: "Amount is not checked." }])));
    expect(await main(["review"], t)).toBe(EXIT.ok);
    const text = t.stdout.join("\n");
    expect(text).toContain("#1");
    expect(text).toContain("[likely]");
    expect(text).toContain(REVIEW_NOTICE);
    expect(text).toContain("Not sent");
    expect(fs.existsSync(path.join(dir, ".foreman", "review.json"))).toBe(true);

    const r = io(dir, fake(JSON.stringify({ stance: "maintain", reply: "Still applies." })));
    expect(await main(["review", "--reply", "1", "--message", "why?"], r)).toBe(EXIT.ok);
    expect(r.stdout.join("\n")).toContain("reviewer: Still applies.");
  });

  it("does not save with --no-history and can print JSON", async () => {
    const dir = changedRepo();
    const t = io(dir, fake(answer([{ file: "app.js", line: REFUND_LINE, severity: "should-fix", confidence: "low", body: "Check it." }])));
    expect(await main(["review", "--no-history", "--format", "json"], t)).toBe(EXIT.ok);
    expect(JSON.parse(t.stdout.join("")).comments).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, ".foreman", "review.json"))).toBe(false);
  });

  it("exits 2 with a plain message for usage problems and a missing model", async () => {
    const dir = changedRepo();
    const a = io(dir, fake("{}"));
    expect(await main(["review", "--reply", "1"], a)).toBe(EXIT.usage);
    expect(a.errors.join()).toContain("--message");
    const b = io(dir, fake("{}"));
    expect(await main(["review", "--message", "x"], b)).toBe(EXIT.usage);
    const c = io(tempDir(), fake("{}"));
    expect(await main(["review"], c)).toBe(EXIT.usage);
    expect(c.errors.join()).toContain("not a git repository");
    const down: LlmProvider = { name: "x", complete: async () => Promise.reject(new LlmError("Could not reach Ollama at http://localhost:11434.")) };
    const d = io(dir, down);
    expect(await main(["review"], d)).toBe(EXIT.usage);
    expect(d.errors.join()).toContain("Could not reach Ollama");
  });

  it("is the only place the LLM layer is used: scan and the rules never import it", () => {
    const files = ["src/scan.ts", "src/loader.ts", ...fs.readdirSync("src/rules").map((f) => `src/rules/${f}`), ...fs.readdirSync("src/adapters").map((f) => `src/adapters/${f}`)];
    for (const f of files) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/from\s+["'][./]*llm\//);
  });
});

describe("Ollama provider (ADR-0007)", () => {
  const ok = (content: string) => (async () => new Response(JSON.stringify({ message: { content } }), { status: 200 })) as unknown as typeof fetch;

  it("posts to the local chat API with a large enough context and returns the answer", async () => {
    let seen: { url: string; body: Record<string, unknown> } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ message: { content: "hi" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createOllamaProvider({ endpoint: "http://localhost:11434/", model: "m", fetchImpl });
    expect(await p.complete([{ role: "user", content: "x" }], { json: true })).toBe("hi");
    expect(seen!.url).toBe("http://localhost:11434/api/chat");
    expect(seen!.body).toMatchObject({ model: "m", stream: false, format: "json" });
    expect((seen!.body.options as { num_ctx: number }).num_ctx).toBeGreaterThanOrEqual(8192);
    expect(await createOllamaProvider({ endpoint: "http://127.0.0.1:11434", model: "m", fetchImpl: ok("y") }).complete([])).toBe("y");
  });

  it("says what to do when Ollama is off or the model is missing", async () => {
    const off = createOllamaProvider({ endpoint: "http://localhost:11434", model: "m", fetchImpl: (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch });
    await expect(off.complete([])).rejects.toThrow(/Could not reach Ollama/);
    const missing = createOllamaProvider({ endpoint: "http://localhost:11434", model: "m", fetchImpl: (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch });
    await expect(missing.complete([])).rejects.toThrow(/ollama pull m/);
    const weird = createOllamaProvider({ endpoint: "http://localhost:11434", model: "m", fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch });
    await expect(weird.complete([])).rejects.toThrow(/unexpected format/);
  });

  it("refuses any endpoint that is not on this machine", () => {
    expect(() => createOllamaProvider({ endpoint: "https://api.example.com", model: "m" })).toThrow(LlmError);
    expect(() => mergeConfig({ llm: { endpoint: "http://10.0.0.5:11434" } })).toThrow(/this machine/);
    expect(() => mergeConfig({ llm: { endpoint: "http://localhost.evil.test" } })).toThrow(/this machine/);
    expect(() => mergeConfig({ llm: { provider: "openai" } })).toThrow(/ollama/);
    expect(mergeConfig({ llm: { model: " qwen3:8b ", endpoint: "http://[::1]:11434/" } }).llm).toEqual({ provider: "ollama", model: "qwen3:8b", endpoint: "http://[::1]:11434" });
  });
});
