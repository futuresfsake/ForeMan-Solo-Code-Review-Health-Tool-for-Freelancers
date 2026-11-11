import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, main, type Io } from "../src/cli.js";
import { PKG, project, tempDir } from "./helpers.js";

function io(cwd: string): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (t) => stdout.push(t),
    err: (t) => stderr.push(t),
    color: false,
    cwd,
    audit: () => ({ ok: true, vulnerabilities: [] }),
  };
}

const CLEAN = { "index.js": "module.exports = 1;" };
const BAD = { "package.json": PKG, "package-lock.json": "{}", "db.js": `const password = "Sup3r-S3cret!";` };

describe("cli", () => {
  it("exits 0 and reports zero findings on an empty project", async () => {
    const t = io(project(CLEAN));
    expect(await main(["scan", "--no-history"], t)).toBe(EXIT.ok);
    expect(t.stdout.join("\n")).toContain("No open findings.");
    expect(t.stdout.join("\n")).toContain("100 / 100");
  });

  it("exits 1 on blockers and when the score is under --fail-under", async () => {
    expect(await main(["scan", "--no-history"], io(project(BAD)))).toBe(EXIT.failed);
    const unlocked = io(project({ "package.json": PKG }));
    expect(await main(["scan", "--no-history"], unlocked)).toBe(EXIT.ok);
    expect(await main(["scan", "--no-history", "--fail-under", "100"], unlocked)).toBe(EXIT.failed);
  });

  it("exits 2 on usage and config errors", async () => {
    const t = io(project({ ...CLEAN, "foreman.config.json": "{ nope" }));
    expect(await main(["scan"], t)).toBe(EXIT.usage);
    expect(t.stderr.join("\n")).toMatch(/Could not parse/);
    expect(await main(["scan", "does-not-exist"], io(tempDir()))).toBe(EXIT.usage);
    expect(await main(["scan", "--format", "xml"], io(tempDir()))).toBe(EXIT.usage);
    expect(await main(["scan", "--context", "missing.md"], io(tempDir()))).toBe(EXIT.usage);
    expect(await main(["frobnicate"], io(tempDir()))).toBe(EXIT.usage);
  });

  it("prints valid JSON with --format json", async () => {
    const t = io(project(BAD));
    await main(["scan", "--format", "json", "--no-history"], t);
    const parsed = JSON.parse(t.stdout.join("\n"));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.tool).toBe("foreman-solo");
    expect(parsed.findings[0].ruleId).toBe("secrets/hardcoded-password");
    expect(JSON.stringify(parsed)).not.toContain(t.cwd.replace(/\\/g, "\\\\"));
  });

  it("writes HTML and Markdown reports", async () => {
    const t = io(project(BAD));
    await main(["scan", "--report", "html", "--no-history"], t);
    await main(["scan", "--report", "md", "--out", "out", "--no-history"], t);
    expect(fs.readFileSync(path.join(t.cwd, "foreman-report", "report.html"), "utf8")).toContain("<!doctype html>");
    expect(fs.readFileSync(path.join(t.cwd, "out", "report.md"), "utf8")).toContain("# Code health report");
  });

  it("records history and shows the trend on the next scan", async () => {
    const dir = project(BAD);
    const first = io(dir);
    await main(["scan", "--format", "json"], first);
    expect(JSON.parse(first.stdout.join("\n")).trend).toBe("none");
    fs.writeFileSync(path.join(dir, "db.js"), "const password = process.env.DB_PASSWORD;");
    const second = io(dir);
    await main(["scan", "--format", "json"], second);
    const result = JSON.parse(second.stdout.join("\n"));
    expect(result.trend).toBe("up");
    expect(result.previousScan.score).toBeLessThan(result.score);
    const history = JSON.parse(fs.readFileSync(path.join(dir, ".foreman", "history.json"), "utf8"));
    expect(history).toHaveLength(2);
    expect(Object.keys(history[0]).sort()).toEqual(["findingCount", "scannedAt", "score"]);
  });

  it("does not write into the project with --no-history", async () => {
    const dir = project(CLEAN);
    await main(["scan", "--no-history"], io(dir));
    expect(fs.existsSync(path.join(dir, ".foreman"))).toBe(false);
  });

  it("scans many projects with --all and writes a combined summary", async () => {
    const root = tempDir();
    project({ "package.json": JSON.stringify({ name: "alpha" }), "index.js": "module.exports = 1;" }, path.join(root, "clients", "alpha"));
    project({ "package.json": JSON.stringify({ name: "beta" }), "db.js": `const password = "Sup3r-S3cret!";` }, path.join(root, "clients", "beta"));
    const t = io(root);
    expect(await main(["scan", "--all", "clients/*", "--report", "html", "--no-history"], t)).toBe(EXIT.failed);
    const table = t.stdout.join("\n");
    expect(table).toMatch(/alpha\s+100/);
    expect(table).toMatch(/beta\s+91/);
    const summary = fs.readFileSync(path.join(root, "foreman-report", "summary.html"), "utf8");
    expect(summary).toContain('href="beta/report.html"');
    expect(fs.existsSync(path.join(root, "foreman-report", "alpha", "report.html"))).toBe(true);
    expect(await main(["scan", "--all", "nothing/*"], io(root))).toBe(EXIT.usage);
  });

  it("prints help and version with exit code 0", async () => {
    const t = io(tempDir());
    expect(await main(["--help"], t)).toBe(EXIT.ok);
    expect(t.stdout.join("\n")).toContain("scan");
    expect(await main(["--version"], t)).toBe(EXIT.ok);
  });
});
