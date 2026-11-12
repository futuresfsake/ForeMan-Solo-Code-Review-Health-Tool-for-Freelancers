import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT, main, type Io } from "../src/cli.js";
import { ConfigError, mergeConfig } from "../src/config.js";
import { childEnv, findProgram } from "../src/exec.js";
import { UnsafePathError, writeInside } from "../src/fsafe.js";
import { MAX_LINE_CHARS, createRedactor } from "../src/llm/redact.js";
import { runReview } from "../src/llm/review.js";
import type { ChatMessage, LlmProvider } from "../src/llm/provider.js";
import { MAX_TREE_DEPTH } from "../src/loader.js";
import { npmrcNotes, runNpmAudit } from "../src/rules/deps.js";
import { RULES } from "../src/rules/index.js";
import { hasJwt, urlPassword } from "../src/rules/secrets.js";
import { FAKE, PKG, ids, project, scan, tempDir } from "./helpers.js";

/*
 * One test per weakness found in the security review of 2026-11-12
 * (docs/security/security-audit.md). Each of these failed before its fix.
 * The threat in all of them is the same: the project being scanned was written
 * by someone else, and may have been built to mislead or attack the scanner.
 */

const WINDOWS = process.platform === "win32";
const ESC = String.fromCharCode(27);

function io(cwd: string): Io & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, out: (t) => stdout.push(t), err: (t) => stderr.push(t), color: false, cwd, audit: () => ({ ok: true, vulnerabilities: [] }) };
}

function status(result: ReturnType<typeof scan>, id: string): string {
  return result.checklist.find((c) => c.id === id)!.status;
}

/** A directory link that needs no special rights on Windows (a junction) and is a plain symlink elsewhere. */
function linkDir(target: string, link: string): void {
  fs.symlinkSync(target, link, WINDOWS ? "junction" : "dir");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("F-01: a program inside the scanned project is never run", () => {
  it("looks programs up on PATH only, skipping relative entries and folders inside the project", () => {
    const projectDir = project({ "package.json": PKG });
    const realBin = tempDir();
    const name = "foreman-test-tool";
    const file = name + (WINDOWS ? ".exe" : "");
    for (const dir of [projectDir, path.join(projectDir, "bin"), realBin]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), "");
      fs.chmodSync(path.join(dir, file), 0o755);
    }
    vi.stubEnv("PATH", ["", ".", "bin", projectDir, path.join(projectDir, "bin"), realBin].join(path.delimiter));
    expect(findProgram(name, { avoid: projectDir })).toBe(path.join(realBin, file));
    // With only the project's own copies on PATH there is nothing safe to run.
    vi.stubEnv("PATH", [".", projectDir, path.join(projectDir, "bin")].join(path.delimiter));
    expect(findProgram(name, { avoid: projectDir })).toBeNull();
  });

  it("tells child processes not to search the current folder, whatever the caller's environment says", () => {
    vi.stubEnv("NODEFAULTCURRENTDIRECTORYINEXEPATH", "");
    const env = childEnv();
    const keys = Object.keys(env).filter((k) => k.toLowerCase() === "nodefaultcurrentdirectoryinexepath");
    expect(keys).toEqual(["NoDefaultCurrentDirectoryInExePath"]);
    expect(env.NoDefaultCurrentDirectoryInExePath).toBe("1");
  });

  it.runIf(WINDOWS)("does not run an npm.cmd planted in the project during the dependency check", () => {
    const dir = project({ "package.json": PKG, "package-lock.json": JSON.stringify({ name: "fixture-app", lockfileVersion: 3, packages: {} }) });
    const marker = path.join(dir, "RAN.txt");
    fs.writeFileSync(path.join(dir, "npm.cmd"), `@echo off\r\necho ran > "${marker}"\r\necho {}\r\n`);
    // An ordinary shell does not set the guard variable, so the test removes it. No network: npm is told it is offline.
    vi.stubEnv("NoDefaultCurrentDirectoryInExePath", undefined);
    vi.stubEnv("npm_config_offline", "true");
    runNpmAudit(dir);
    expect(fs.existsSync(marker)).toBe(false);
  });
});

describe("F-02: one hostile file cannot switch the checks off for the rest of the project", () => {
  it("still reports a key in another file when one file is a 10,000-term expression", () => {
    const r = scan({ "a.js": `var x = ${Array(10_000).fill("1").join("+")};\n`, "b.js": `const k = "${FAKE.aws}";\n` });
    expect(ids(r)).toContain("secrets/hardcoded-api-key");
    expect(r.coverage.rulesSkipped.filter((s) => s.reason.startsWith("internal error"))).toEqual([]);
  });

  it("does not analyse a file nested past the limit as code, but still runs the text checks on it and says so", () => {
    const deep = "[".repeat(MAX_TREE_DEPTH + 50) + "]".repeat(MAX_TREE_DEPTH + 50);
    const r = scan({ "deep.js": `const k = "${FAKE.aws}";\nvar x = ${deep};\n`, "ok.js": "module.exports = 1;\n" });
    expect(r.coverage.filesNotAnalysed).toBe(1);
    expect(r.warnings.join("\n")).toMatch(/deep\.js: (nested \d+ levels deep|could not be parsed)/);
    expect(r.findings.filter((f) => f.file === "deep.js").map((f) => f.ruleId)).toEqual(["secrets/hardcoded-api-key"]);
  });

  it("marks code-based checklist items unverified when a file could not be analysed", () => {
    const deep = "[".repeat(MAX_TREE_DEPTH + 50) + "]".repeat(MAX_TREE_DEPTH + 50);
    const r = scan({ "deep.js": `var x = ${deep};\n` });
    expect(r.findings).toEqual([]);
    expect(status(r, "GL-01")).toBe("unverified");
    expect(r.readyToShip).toBe(false);
  });

  it("exits with the internal-error code when a rule fails, even with no findings", async () => {
    vi.spyOn(RULES[0]!, "run").mockImplementation(() => {
      throw new Error("boom");
    });
    const t = io(project({ "index.js": "module.exports = 1;" }));
    expect(await main(["scan", "--no-history", "--no-audit"], t)).toBe(EXIT.internal);
    const out = t.stdout.join("\n");
    expect(out).toContain("The result is incomplete");
    expect(out).toMatch(/GL-01 .*rule for this item did not run|GL-01 .*rules for this item did not run/);
  });
});

describe("F-03: a checklist item passes only when every rule behind it ran", () => {
  it("is unverified, not passed, when a secrets rule is turned off", () => {
    const off = scan({ "index.js": "module.exports = 1;" }, { rules: { "secrets/hardcoded-api-key": "off" } });
    expect(status(off, "GL-01")).toBe("unverified");
    expect(off.checklist.find((c) => c.id === "GL-01")!.note).toContain("secrets/hardcoded-api-key");
    expect(status(scan({ "index.js": "module.exports = 1;" }), "GL-01")).toBe("pass");
  });
});

describe("F-04: nothing is written through a link that came with the project", () => {
  it("refuses a target outside the base and a path that passes through a link", () => {
    const base = tempDir();
    const elsewhere = tempDir();
    expect(() => writeInside(base, "../escape.txt", "x")).toThrow(UnsafePathError);
    linkDir(elsewhere, path.join(base, "out"));
    expect(() => writeInside(base, path.join("out", "report.html"), "x")).toThrow(UnsafePathError);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(fs.readFileSync(writeInside(base, path.join("real", "report.html"), "ok"), "utf8")).toBe("ok");
  });

  it("does not write scan history through a linked .foreman folder", async () => {
    const elsewhere = tempDir();
    const dir = project({ "index.js": "module.exports = 1;" });
    linkDir(elsewhere, path.join(dir, ".foreman"));
    const t = io(dir);
    expect(await main(["scan", "--no-audit"], t)).toBe(EXIT.ok);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(t.stdout.join("\n")).toContain("Could not write scan history");
  });

  it("does not write a report through a linked foreman-report folder", async () => {
    const elsewhere = tempDir();
    const dir = project({ "index.js": "module.exports = 1;" });
    linkDir(elsewhere, path.join(dir, "foreman-report"));
    const t = io(dir);
    expect(await main(["scan", "--no-audit", "--no-history", "--report", "html"], t)).toBe(EXIT.usage);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
    expect(t.stderr.join("\n")).toContain("is a link");
  });
});

describe("F-05: text from the project cannot drive the terminal or a report", () => {
  const hostileName = `shop${ESC}[2J${ESC}[1;1H${ESC}]0;owned\u0007 <img src=x onerror=alert(1)> | [link](http://x)`;
  const files = {
    "package.json": JSON.stringify({ name: hostileName, dependencies: { express: "^4.19.0" } }),
    "package-lock.json": "{}",
    "app.js": `const express = require('express');\nconst app = express();\napp.delete('/admin/${"\\u001b"}[2Kusers', (req, res) => res.end());\nconst dbPassword = "Sup3r-S3cret!";\n`,
  };

  it("prints no escape sequence in text or JSON output", async () => {
    for (const format of ["text", "json"]) {
      const t = io(project(files));
      await main(["scan", "--no-history", "--no-audit", "--format", format], t);
      const out = t.stdout.join("\n");
      expect(out).toContain("shop");
      expect(out.includes(ESC)).toBe(false);
      expect(out.includes("\\u001b")).toBe(false);
    }
  });

  it("keeps project text as text in the Markdown and HTML reports", async () => {
    const dir = project(files);
    await main(["scan", "--no-history", "--no-audit", "--report", "md"], io(dir));
    await main(["scan", "--no-history", "--no-audit", "--report", "html"], io(dir));
    const md = fs.readFileSync(path.join(dir, "foreman-report", "report.md"), "utf8");
    const html = fs.readFileSync(path.join(dir, "foreman-report", "report.html"), "utf8");
    expect(md).not.toContain("<img");
    expect(md).not.toContain("[link](");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain(`http-equiv="Content-Security-Policy" content="default-src 'none'`);
  });

  it("ignores history entries that are not exactly a timestamp and a score", async () => {
    const dir = project({
      "index.js": "module.exports = 1;",
      ".foreman/history.json": JSON.stringify([{ scannedAt: `2026-01-01${ESC}[2J`, score: 10, extra: "kept?" }, { scannedAt: "not a date", score: 50 }]),
    });
    const t = io(dir);
    await main(["scan", "--no-audit"], t);
    const out = t.stdout.join("\n");
    expect(out).toContain("first scan");
    expect(out.includes(ESC)).toBe(false);
    expect(fs.readFileSync(path.join(dir, ".foreman", "history.json"), "utf8")).not.toContain("kept?");
  });
});

describe("F-06: a project's own config cannot quietly narrow the scan or reach outside the project", () => {
  const hiding = { ignorePaths: ["src"], rules: { "secrets/hardcoded-api-key": "off" }, weights: { blocker: 0 } };
  const files = { "src/keys.js": `const k = "${FAKE.aws}";\n`, "foreman.config.json": JSON.stringify(hiding) };

  it("names every config key that changes the scan, in every output", async () => {
    const dir = project(files);
    const t = io(dir);
    await main(["scan", "--no-history", "--no-audit", "--report", "html"], t);
    expect(t.stdout.join("\n")).toContain("The config in effect changes the scan: ignorePaths, weights, rules.");
    expect(fs.readFileSync(path.join(dir, "foreman-report", "report.html"), "utf8")).toContain("The config in effect changes the scan");
    expect(scan({ "index.js": "module.exports = 1;" }).coverage.configChanges).toEqual([]);
  });

  it("scans with the defaults under --no-project-config", async () => {
    const withConfig = io(project(files));
    expect(await main(["scan", "--no-history", "--no-audit"], withConfig)).toBe(EXIT.ok);
    const without = io(project(files));
    expect(await main(["scan", "--no-history", "--no-audit", "--no-project-config"], without)).toBe(EXIT.failed);
    expect(without.stdout.join("\n")).toContain("secrets/hardcoded-api-key");
    expect(without.stdout.join("\n")).not.toContain("The config in effect changes the scan");
  });

  it("rejects a report folder outside the working folder", () => {
    for (const outDir of ["/tmp/x", "C:\\Users\\x", "..\\x", "a/../../x", "\\\\server\\share", "C:x", ""]) {
      expect(() => mergeConfig({ report: { outDir } }), outDir).toThrow(ConfigError);
    }
    expect(mergeConfig({ report: { outDir: "./reports/foreman" } }).report.outDir).toBe("./reports/foreman");
  });

  it("embeds a logo only from inside the project, unless the config is the user's own", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const outside = tempDir();
    fs.writeFileSync(path.join(outside, "private.png"), png);
    const logo = path.join(outside, "private.png");
    const dir = project({ "index.js": "module.exports = 1;", "foreman.config.json": JSON.stringify({ report: { logo } }) });
    const t = io(dir);
    expect(await main(["scan", "--no-history", "--no-audit", "--report", "client"], t)).toBe(EXIT.usage);
    expect(t.stderr.join("\n")).toContain("inside the project folder");
    expect(fs.existsSync(path.join(dir, "foreman-report", "client-report.html"))).toBe(false);

    const own = path.join(outside, "my.config.json");
    fs.writeFileSync(own, JSON.stringify({ report: { logo } }));
    expect(await main(["scan", "--no-history", "--no-audit", "--report", "client", "--config", own], io(dir))).toBe(EXIT.ok);
    expect(fs.readFileSync(path.join(dir, "foreman-report", "client-report.html"), "utf8")).toContain("data:image/png;base64,");
  });

  it("warns when the project's .npmrc redirects the dependency check", () => {
    const dir = project({ ".npmrc": "registry=https://registry.example.test/\nstrict-ssl=false\n@acme:registry=https://npm.example.test/\nsave-exact=true\n" });
    expect(npmrcNotes(dir).join(" ")).toContain("a scoped registry, registry, strict-ssl");
    expect(npmrcNotes(project({ ".npmrc": "save-exact=true\n" }))).toEqual([]);
    expect(npmrcNotes(tempDir())).toEqual([]);
  });
});

describe("F-07: no input makes a pattern take more than a moment", () => {
  it("finds connection-string passwords and tokens with the bounded matchers", () => {
    const password = ["Pa55", "w0rd-xyz"].join("");
    expect(urlPassword(`const u = "postgres://admin:${password}@db.example.test/app";`)).toBe(password);
    expect(urlPassword("see https://example.test/docs and redis://localhost:6379")).toBeNull();
    const jwt = ["eyJhbGciOiJIUzI1", "eyJzdWIiOiIxMjM0NTY3", "abcDEF123456xyz"].join(".");
    expect(hasJwt(`const t = "${jwt}";`)).toBe(true);
    expect(hasJwt("const t = 'eyJhbGciOiJIUzI1.not-a-token';")).toBe(false);
  });

  it("scans megabyte-long hostile lines quickly", () => {
    const started = Date.now();
    const r = scan({
      "url.js": `// ${"a.".repeat(250_000)}\n`,
      "jwt.js": `// ${"eyJaaaaaaaa-".repeat(40_000)}\n`,
      "scheme.js": `// ${"://".repeat(150_000)}\n`,
      "placeholder.js": `const password = "${"<a".repeat(200_000)}";\n`,
      "ignore.js": `const password = "Sup3r-S3cret!"; // foreman-ignore secrets/hardcoded-password:${" ".repeat(300_000)}x \n`,
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.coverage.rulesSkipped.filter((s) => s.reason.startsWith("internal error"))).toEqual([]);
  });

  it("leaves very long lines out of a prompt instead of masking them", () => {
    const mask = createRedactor();
    const long = `const k = "${FAKE.aws}"; ${"x".repeat(MAX_LINE_CHARS)}`;
    expect(mask.line(long, "clean")).toBe(`[line of ${long.length} characters left out]`);
    expect(mask.line(`const k = "${FAKE.aws}";`, "clean")).toContain("[REDACTED AWS access key ID]");
  });
});

describe("F-08: the review prompt has a hard size limit", () => {
  function git(dir: string, ...args: string[]): void {
    execFileSync("git", ["-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" });
  }

  it("cuts a change with hundreds of routes and findings to fit, and says what it cut", async () => {
    const head = "const express = require('express');\nconst app = express();\n";
    const dir = project({ "package.json": PKG, "package-lock.json": "{}", "app.js": head });
    git(dir, "init", "-q");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "initial");
    const routes = Array.from({ length: 400 }, (_, i) => `app.delete('/admin/things${i}/:id', (req, res) => { db.query("DELETE FROM t WHERE id = " + req.params.id); res.end(); });`);
    fs.writeFileSync(path.join(dir, "app.js"), `${head}${routes.join("\n")}\n`);

    const prompts: ChatMessage[][] = [];
    const model: LlmProvider = {
      name: "fake-model",
      async complete(messages) {
        prompts.push(messages);
        return JSON.stringify({ comments: [] });
      },
    };
    const result = await runReview({ root: dir, base: "HEAD", config: mergeConfig({}), provider: model });
    const size = prompts[0]!.reduce((n, m) => n + m.content.length, 0);
    expect(size).toBeLessThanOrEqual(26_000);
    expect(prompts[0]![1]!.content).toContain("Answer with JSON only");
    expect(result.notes.join("\n")).toMatch(/most serious of \d+ scan findings/);
    expect(result.notes.join("\n")).toContain("was left out to keep the prompt inside the model's context");
  }, 30_000);
});
