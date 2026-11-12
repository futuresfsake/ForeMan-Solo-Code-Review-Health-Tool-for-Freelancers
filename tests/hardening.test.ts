import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, main, type Io } from "../src/cli.js";
import { ConfigError, isCloudModel, mergeConfig } from "../src/config.js";
import { ReviewError, getDiff } from "../src/llm/diff.js";
import { runExplain } from "../src/llm/explain.js";
import { LlmError, createOllamaProvider, type ChatMessage, type LlmProvider } from "../src/llm/provider.js";
import { createRedactor } from "../src/llm/redact.js";
import { renderComment, renderExplain } from "../src/llm/render.js";
import { normalizeComments, replyToComment, type ReviewComment } from "../src/llm/review.js";
import { printable } from "../src/llm/text.js";
import { PLAIN } from "../src/report/text.js";
import { scanProject } from "../src/scan.js";
import { PKG, project } from "./helpers.js";

function fake(answer: string): LlmProvider & { prompts: ChatMessage[][] } {
  const prompts: ChatMessage[][] = [];
  return {
    name: "fake-model",
    prompts,
    async complete(messages) {
      prompts.push(messages);
      return answer;
    },
  };
}

function git(dir: string, ...args: string[]): void {
  execFileSync("git", ["-C", dir, "-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { stdio: "ignore" });
}

const slash = (p: string): string => p.replace(/\\/g, "/");

/** A committed repo whose own git settings name a program; the program leaves a marker file when it runs. */
function trappedRepo(kind: "fsmonitor" | "filter", filterName = "trap"): { dir: string; ran: () => boolean } {
  const dir = project({ "package.json": PKG, "app.js": "const a = 1;\n", ".env": "NAME=value\n", ".gitattributes": `*.js filter=${filterName}\n` });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  const marker = path.join(dir, "RAN.txt");
  const script = path.join(dir, "trap.sh");
  fs.writeFileSync(script, `#!/bin/sh\necho ran > "${slash(marker)}"\n${kind === "filter" ? "cat\n" : ""}`);
  fs.chmodSync(script, 0o755);
  if (kind === "fsmonitor") git(dir, "config", "core.fsmonitor", slash(script));
  else {
    git(dir, "config", `filter.${filterName}.clean`, `sh "${slash(script)}"`);
    git(dir, "config", `filter.${filterName}.required`, "true");
  }
  fs.writeFileSync(path.join(dir, "app.js"), "const a = 2;\n");
  return { dir, ran: () => fs.existsSync(marker) };
}

describe("a repository's own git settings never run a program", () => {
  it("scan does not run a file-system monitor named in .git/config", () => {
    const { dir, ran } = trappedRepo("fsmonitor");
    scanProject(dir, { config: mergeConfig({}) });
    expect(ran()).toBe(false);
  });

  it("review's git diff does not run a file-system monitor", () => {
    const { dir, ran } = trappedRepo("fsmonitor");
    expect(getDiff(dir, "HEAD")).toContain("+const a = 2;");
    expect(ran()).toBe(false);
  });

  it("review's git diff does not run a content filter, even a required one", () => {
    const { dir, ran } = trappedRepo("filter");
    expect(getDiff(dir, "HEAD")).toContain("+const a = 2;");
    expect(ran()).toBe(false);
  });

  it("refuses to diff when a filter name could not be overridden", () => {
    const { dir, ran } = trappedRepo("filter", "a=b");
    expect(() => getDiff(dir, "HEAD")).toThrow(ReviewError);
    expect(ran()).toBe(false);
  });
});

describe("code stays on this machine (ADR-0007)", () => {
  it("refuses Ollama cloud models, from the config and from --model", () => {
    for (const name of ["qwen3-coder:480b-cloud", "glm-4.6:cloud", "GPT-OSS:120B-CLOUD"]) {
      expect(isCloudModel(name)).toBe(true);
      expect(() => mergeConfig({ llm: { model: name } })).toThrow(ConfigError);
      expect(() => createOllamaProvider({ endpoint: "http://localhost:11434", model: name })).toThrow(LlmError);
    }
    for (const name of ["qwen2.5-coder:7b", "cloudy:7b", "llama3.2"]) expect(isCloudModel(name)).toBe(false);
  });

  it("never follows a redirect", async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ message: { content: "x" } }), { status: 200 });
    }) as unknown as typeof fetch;
    await createOllamaProvider({ endpoint: "http://localhost:11434", model: "m", fetchImpl }).complete([]);
    expect(seen?.redirect).toBe("error");
  });
});

describe("masking", () => {
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abcDEF123456ghiJKL"].join(".");

  it("masks a password inside a connection string, a JWT and a bearer token, on any line", () => {
    const mask = createRedactor();
    const out = mask.text(
      [
        "const DATABASE_URL = 'postgres://admin:Sup3rS3cretPw@db.internal:5432/prod';",
        `const header = 'Bearer ${jwt}';`,
        "fetch(u, { headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz012345' } });",
      ].join("\n"),
      new Set<number>(),
    );
    expect(out).toContain("postgres://admin:[REDACTED]@db.internal:5432/prod");
    expect(out).not.toContain("Sup3rS3cretPw");
    expect(out).not.toContain("eyJhbGci");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(mask.count).toBe(3);
  });

  it("leaves placeholders and ordinary URLs readable", () => {
    const mask = createRedactor();
    const text = ["const u = `mongodb://${user}:${pass}@host/db`;", "const site = 'https://example.test:8080/path';", "const t = `Bearer ${token}`;"].join("\n");
    expect(mask.text(text, new Set<number>())).toBe(text);
    expect(mask.count).toBe(0);
  });
});

describe("a saved review that came with the project", () => {
  function planted(file: string, extra: Record<string, string> = {}): string {
    const comment = { id: 1, file, line: 2, severity: "blocker", confidence: "low", body: "b", thread: [] };
    return project({
      "package.json": PKG,
      "app.js": "const x = 1;\n",
      ".env": "A=1\nDB_PASSWORD=hunter2-prod-pass\n",
      ".foreman/review.json": JSON.stringify({ schemaVersion: 1, tool: "foreman-solo", kind: "review", comments: [comment] }),
      ...extra,
    });
  }

  it("cannot make --reply send a settings file to the model", async () => {
    const model = fake(JSON.stringify({ stance: "maintain", reply: "ok" }));
    await expect(replyToComment(planted(".env"), model, 1, "why?")).rejects.toThrow(/not source code/);
    await expect(replyToComment(planted("../outside.js"), model, 1, "why?")).rejects.toThrow(/outside the project/);
    expect(model.prompts).toHaveLength(0);
  });

  it("cannot move the cursor or hide text when it is printed", () => {
    const comment = { id: 1, file: "app.js\u001b[2J", line: 1, severity: "blocker", confidence: "low", body: "x\u001b]0;title\u0007y", thread: [{ from: "reviewer", text: "a‮b" }] } as ReviewComment;
    const text = renderComment(comment, PLAIN).join("\n");
    expect(text).not.toMatch(/[\u001b\u0007‮]/);
    expect(text).toContain("app.js[2J");
  });
});

describe("model answers are cleaned before they are kept or printed", () => {
  it("strips control and text-direction characters", () => {
    expect(printable("a\u001b[31mb\r\nc\u0000‮​ d")).toBe("a[31mb c d");
    expect(printable(42)).toBe("");
  });

  it("review comments and the explain walkthrough carry no escape sequences", async () => {
    const changed = [{ path: "app.js", rows: [], added: [1] }];
    const { comments } = normalizeComments([{ file: "app.js", line: 1, body: "bad\u001b[2J thing" }], changed);
    expect(comments[0]!.body).toBe("bad[2J thing");

    const dir = project({ "package.json": PKG, "app.js": "const express = require('express');\nconst app = express();\napp.get('/h', (q, s) => s.end('ok'));\n" });
    const answer = JSON.stringify({ overview: "fine \u001b[2J\u001b]0;t\u0007 text", areas: [{ name: "a\u001b[1m", files: ["app.js"], what: "w" }] });
    const result = await runExplain({ root: dir, config: mergeConfig({}), provider: fake(answer) });
    expect(JSON.stringify(result)).not.toMatch(/\\u001b|\\u0007/);
    expect(renderExplain(result, PLAIN)).not.toMatch(/[\u001b\u0007]/);
  });
});

describe("explain keeps its prompt inside the model's context", () => {
  it("caps routes and findings, says so, and stays under the size limit", async () => {
    const routes = Array.from({ length: 600 }, (_, i) => `app.post('/api/v1/resource-${i}/:id/details', (q, s) => s.end('ok'));`).join("\n");
    const filler = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`lib/module-${i}.js`, `// module ${i}\n${"const value = 1;\n".repeat(200)}`]));
    const dir = project({ "package.json": PKG, "app.js": `const express = require('express');\nconst app = express();\n${routes}\n`, ...filler });
    const result = await runExplain({ root: dir, config: mergeConfig({}), provider: fake("{}"), dryRun: true });
    expect(result.promptPreview!.length).toBeLessThanOrEqual(20_100);
    expect(result.promptPreview).toContain("560 more not listed");
    expect(result.notes.join("\n")).toMatch(/Only the first 40 of 600 routes/);
    expect(result.notes.join("\n")).toMatch(/most serious of \d+ scan findings/);
    expect(result.filesRead.length).toBeGreaterThan(0);
  });
});

describe("command", () => {
  it("--model with a cloud model is a usage error and nothing is sent", async () => {
    const dir = project({ "package.json": PKG, "app.js": "const x = 1;\n" });
    const errors: string[] = [];
    const io: Io = { out: () => {}, err: (t) => errors.push(t), color: false, cwd: dir, audit: () => ({ ok: true, vulnerabilities: [] }) };
    expect(await main(["explain", "--model", "qwen3-coder:480b-cloud"], io)).toBe(EXIT.usage);
    expect(errors.join()).toMatch(/Ollama's servers/);
  });
});
