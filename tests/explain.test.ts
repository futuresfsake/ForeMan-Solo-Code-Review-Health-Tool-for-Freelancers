import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, main, type Io } from "../src/cli.js";
import { mergeConfig } from "../src/config.js";
import { normalizeExplain, runExplain } from "../src/llm/explain.js";
import type { ChatMessage, LlmProvider } from "../src/llm/provider.js";
import { ReviewError } from "../src/llm/diff.js";
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

const APP = [
  "const express = require('express');",
  "const db = require('./db');",
  "const app = express();",
  "const apiToken = \"abcd1234efgh5678\";",
  "app.post('/orders/:id/refund', (req, res) => {",
  "  db.query(\"SELECT * FROM orders WHERE id = \" + req.params.id);",
  "  res.json({ ok: true });",
  "});",
  "",
].join("\n");

function repo(): string {
  return project({
    "package.json": PKG,
    "package-lock.json": "{}",
    "app.js": APP,
    "db.js": "module.exports = { query() {} };\n",
    ".env": "NAME=topsecretvalue\n",
  });
}

const good = JSON.stringify({
  overview: "A small orders API.",
  areas: [
    { name: "Orders", files: ["app.js", "./nope.js"], what: "Takes refund requests." },
    { name: "", files: [], what: "no name, dropped" },
  ],
  risks: [
    { file: "app.js", severity: "blocker", body: "Refund route builds SQL from user input." },
    { file: "ghost.js", severity: "blocker", body: "Invented file, dropped." },
    { file: "db.js", severity: "weird", body: "Unknown severity falls back." },
  ],
  beforeYouStart: ["Run the tests.", ""],
});

describe("explain (FR-28)", () => {
  it("sends facts, routes and code samples, masks secrets, and never sends settings files", async () => {
    const dir = repo();
    const model = fake(good);
    await runExplain({ root: dir, config: mergeConfig({}), provider: model });
    const prompt = model.prompts[0]!.map((m) => m.content).join("\n");
    expect(prompt).toContain("POST /orders/:id/refund");
    expect(prompt).toContain("injection/sql-concat");
    expect(prompt).toContain("=== app.js");
    expect(prompt).toContain("=== db.js");
    expect(prompt).not.toContain("abcd1234efgh5678");
    expect(prompt).not.toContain("topsecretvalue");
  });

  it("keeps only what can be checked against real files", async () => {
    const result = await runExplain({ root: repo(), config: mergeConfig({}), provider: fake(good) });
    expect(result.overview).toBe("A small orders API.");
    expect(result.areas).toEqual([{ name: "Orders", files: ["app.js"], what: "Takes refund requests." }]);
    expect(result.risks.map((r) => [r.file, r.severity])).toEqual([
      ["app.js", "blocker"],
      ["db.js", "should-fix"],
    ]);
    expect(result.beforeYouStart).toEqual(["Run the tests."]);
  });

  it("rejects an answer in the wrong shape", () => {
    expect(() => normalizeExplain("nope", new Set())).toThrow(ReviewError);
    expect(() => normalizeExplain({ areas: [], overview: "" }, new Set())).toThrow(ReviewError);
  });

  it("says so when there is no source to explain", async () => {
    const model = fake(good);
    const result = await runExplain({ root: project({ "package.json": PKG }), config: mergeConfig({}), provider: model });
    expect(model.prompts).toHaveLength(0);
    expect(result.notes[0]).toMatch(/No source files/);
  });

  describe("command", () => {
    function io(cwd: string, model: LlmProvider): Io & { stdout: string[] } {
      const stdout: string[] = [];
      return { stdout, out: (t) => stdout.push(t), err: () => {}, color: false, cwd, audit: () => ({ ok: true, vulnerabilities: [] }), llm: () => model };
    }

    it("prints a walkthrough and writes nothing into the project", async () => {
      const dir = repo();
      const o = io(dir, fake(good));
      expect(await main(["explain"], o)).toBe(EXIT.ok);
      const text = o.stdout.join("\n");
      expect(text).toContain("What it is");
      expect(text).toContain("Refund route builds SQL");
      expect(text).toContain("can be wrong");
      expect(fs.existsSync(path.join(dir, ".foreman"))).toBe(false);
    });

    it("--dry-run prints the prompt and sends nothing", async () => {
      const model = fake(good);
      const o = io(repo(), model);
      expect(await main(["explain", "--dry-run"], o)).toBe(EXIT.ok);
      expect(model.prompts).toHaveLength(0);
      expect(o.stdout.join("\n")).toContain("Nothing was sent");
    });

    it("--format json prints the result", async () => {
      const o = io(repo(), fake(good));
      await main(["explain", "--format", "json"], o);
      expect(JSON.parse(o.stdout.join("\n")).kind).toBe("explain");
    });
  });
});
