import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT, main, type Io } from "../src/cli.js";
import { mergeConfig } from "../src/config.js";
import { renderClientHtml } from "../src/report/client.js";
import { DISCLAIMER } from "../src/report/text.js";
import { CATALOG } from "../src/rules/catalog.js";
import { scanProject } from "../src/scan.js";
import { NOW, PKG, project, scan } from "./helpers.js";

function io(cwd: string): Io & { stdout: string[] } {
  const stdout: string[] = [];
  return { stdout, out: (t) => stdout.push(t), err: () => {}, color: false, cwd, audit: () => ({ ok: true, vulnerabilities: [] }) };
}

const LEAKY = {
  "package.json": PKG,
  "package-lock.json": "{}",
  "app.js": `
    const express = require('express');
    const app = express();
    const dbPassword = "Sup3r-S3cret!";
    app.delete('/admin/users/:id', (req, res) => res.end());
  `,
};

describe("init", () => {
  it("creates a valid config, git-ignores output, and adds a workflow with --ci", async () => {
    const dir = project({ ".gitignore": "node_modules" });
    const t = io(dir);
    expect(await main(["init", "--ci"], t)).toBe(EXIT.ok);
    const config = JSON.parse(fs.readFileSync(path.join(dir, "foreman.config.json"), "utf8"));
    expect(() => mergeConfig(config)).not.toThrow();
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("node_modules\n.foreman/\nforeman-report/\n");
    const workflow = fs.readFileSync(path.join(dir, ".github", "workflows", "foreman-solo.yml"), "utf8");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("foreman-solo scan");
    // The initialised project still scans cleanly.
    expect(scanProject(dir, { config: mergeConfig(config), now: NOW }).score).toBe(100);
  });

  it("never overwrites existing files and is safe to run twice", async () => {
    const dir = project({ "foreman.config.json": `{"failUnder": 90}` });
    await main(["init"], io(dir));
    const again = io(dir);
    await main(["init"], again);
    expect(fs.readFileSync(path.join(dir, "foreman.config.json"), "utf8")).toBe(`{"failUnder": 90}`);
    expect(again.stdout.join("\n")).toContain("already exists");
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(".foreman/\nforeman-report/\n");
    expect(fs.existsSync(path.join(dir, ".github"))).toBe(false);
  });
});

describe("risk in plain English", () => {
  it("gives every rule a hedged business consequence and a plain title", () => {
    for (const [id, meta] of Object.entries(CATALOG)) {
      expect(meta.risk.length, id).toBeGreaterThan(40);
      expect(meta.plainTitle.length, id).toBeGreaterThan(10);
      // No promises and no invented figures: these create legal exposure.
      expect(meta.risk, id).not.toMatch(/\bwill\b|guarantee|\$\d|\d+%/i);
    }
  });

  it("attaches the risk to each finding", () => {
    const f = scan(LEAKY).findings.find((x) => x.ruleId === "secrets/hardcoded-password")!;
    expect(f.risk).toBe(CATALOG["secrets/hardcoded-password"]!.risk);
  });
});

describe("client report", () => {
  it("is non-technical: no file paths, rule IDs, secrets or security claims", () => {
    const html = renderClientHtml(scan(LEAKY), { preparedBy: "Sam <Dev>", clientName: "Acme Ltd" });
    expect(html).toContain("A password or secret is written into the code");
    expect(html).toContain("Prepared for Acme Ltd");
    expect(html).toContain("Prepared by Sam &lt;Dev&gt;");
    expect(html).toContain("Fix before launch");
    expect(html).toContain("not a security audit");
    expect(html).not.toMatch(/app\.js|secrets\/|auth\/|Sup3r|https?:\/\//);
    // The only mention of "secure" is the disclaimer saying it cannot be proven.
    expect(html.replace(DISCLAIMER, "")).not.toMatch(/is secure|certified|guaranteed|no vulnerabilities/i);
  });

  it("does not call a clean result secure", () => {
    const html = renderClientHtml(scan({ "index.js": "module.exports = 1;" }));
    expect(html).toContain("did not raise any items");
    expect(html.replace(DISCLAIMER, "")).not.toMatch(/is secure|safe to launch/i);
  });

  describe("branding (FR-26)", () => {
    // A 1x1 transparent PNG.
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

    async function run(report: Record<string, unknown>, extra: Record<string, string | Buffer> = {}) {
      const dir = project({ ...LEAKY, "foreman.config.json": JSON.stringify({ report }) });
      for (const [name, data] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), data);
      const t = io(dir);
      const errors: string[] = [];
      t.err = (m) => errors.push(m);
      const code = await main(["scan", "--report", "client", "--no-history", "--no-audit"], t);
      const file = path.join(dir, "foreman-report", "client-report.html");
      return { code, errors, html: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "" };
    }

    it("embeds the logo and accent colour with no external requests", async () => {
      const { code, html } = await run({ preparedBy: "Sam", logo: "logo.png", accentColor: "#c2410c" }, { "logo.png": PNG });
      expect(code).toBe(EXIT.failed); // LEAKY has blockers; the report is still written
      expect(html).toContain('src="data:image/png;base64,');
      expect(html).toContain("#c2410c");
      expect(html).toContain('alt="Sam logo"');
      expect(html).not.toMatch(/https?:\/\/|<script/);
    });

    it("renders the same page as before when no brand is set", async () => {
      const { html } = await run({ clientName: "Acme Ltd" });
      expect(html).not.toContain("<img");
      expect(html).not.toContain("border-left:4px");
    });

    it("rejects a missing, oversized or non-image logo and a bad colour", async () => {
      expect((await run({ logo: "nope.png" })).errors.join()).toContain("Logo file not found");
      expect((await run({ logo: "notes.txt" }, { "notes.txt": "x" })).errors.join()).toContain("png, jpg, gif, webp or svg");
      expect((await run({ logo: "big.png" }, { "big.png": Buffer.alloc(300 * 1024) })).errors.join()).toContain("larger than 256 KB");
      const bad = await run({ accentColor: "red;} body{display:none" });
      expect(bad.code).toBe(EXIT.usage);
      expect(bad.errors.join()).toContain("accentColor");
    });

    it("escapes the alt text", async () => {
      const { html } = await run({ preparedBy: `"><script>x</script>`, logo: "logo.png" }, { "logo.png": PNG });
      expect(html).not.toContain("<script>x");
    });
  });

  it("is written by --report client using names from the config", async () => {
    const dir = project({ ...LEAKY, "foreman.config.json": JSON.stringify({ report: { clientName: "Acme Ltd" } }) });
    await main(["scan", "--report", "client", "--no-history"], io(dir));
    const html = fs.readFileSync(path.join(dir, "foreman-report", "client-report.html"), "utf8");
    expect(html).toContain("Prepared for Acme Ltd");
  });
});
