import { describe, expect, it } from "vitest";
import { ConfigError, mergeConfig } from "../src/config.js";
import { renderHtml } from "../src/report/html.js";
import { renderMarkdown } from "../src/report/text.js";
import { PKG, ids, scan } from "./helpers.js";

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

const status = (r: ReturnType<typeof scan>, id: string) => r.checklist.find((c) => c.id === id)!.status;

describe("scan", () => {
  it("scores a clean project 100 and is deterministic", () => {
    const clean = scan({ "index.js": "module.exports = 1;" });
    expect(clean.score).toBe(100);
    expect(clean.findings).toEqual([]);
    expect(JSON.stringify(scan(LEAKY))).toBe(JSON.stringify(scan(LEAKY)));
  });

  it("subtracts weighted penalties and caps repeats per rule", () => {
    // blocker x medium (15 x 0.6 = 9), twice, plus should-fix x low (5 x 0.3 = 1.5) -> 100 - 19.5
    expect(scan(LEAKY).score).toBe(81);
    const many = Array.from({ length: 10 }, (_, i) => `const password${i} = "Sup3r-S3cret-${i}";`).join("\n");
    expect(scan({ "a.js": many }).score).toBe(100 - 27);
  });

  it("rolls findings up into the go-live checklist", () => {
    const r = scan(LEAKY);
    expect(status(r, "GL-01")).toBe("fail");
    expect(status(r, "GL-06")).toBe("fail");
    expect(status(r, "GL-03")).toBe("fail");
    expect(status(r, "GL-05")).toBe("pass");
    expect(status(r, "GL-04")).toBe("unverified");
    expect(r.readyToShip).toBe(false);
  });

  it("marks route items unverified without a supported framework, and accepts attestations", () => {
    const r = scan({ "index.js": "module.exports = 1;" });
    expect(["GL-03", "GL-06", "GL-07"].map((id) => status(r, id))).toEqual(["unverified", "unverified", "unverified"]);
    expect(r.coverage.rulesSkipped.map((s) => s.id)).toContain("auth/missing-on-sensitive-route");
    const attested = scan({ "index.js": "module.exports = 1;" }, { checklist: { attest: { "GL-04": "Nightly dump", "GL-03": "CDN", "GL-06": "n/a", "GL-07": "n/a" } } });
    expect(attested.readyToShip).toBe(true);
  });

  it("does not let an attestation override a failing item", () => {
    const r = scan(LEAKY, { checklist: { attest: { "GL-06": "trust me" } } });
    expect(status(r, "GL-06")).toBe("fail");
  });

  it("suppresses inline and by config only when a reason is given", () => {
    const files = {
      "a.js": `
        // foreman-ignore secrets/hardcoded-password: fixture value used by the demo seed
        const password = "Sup3r-S3cret!";
        const token = "T0ken-Value-99"; // foreman-ignore secrets/hardcoded-password
      `,
    };
    const r = scan(files);
    expect(ids(r)).toEqual(["secrets/hardcoded-password"]);
    expect(r.findings.find((f) => f.suppressed)!.suppressed!.reason).toMatch(/demo seed/);
    expect(r.warnings.join(" ")).toMatch(/no reason/);
    const byConfig = scan(files, { ignore: [{ ruleId: "secrets/hardcoded-password", file: "a.js", reason: "legacy" }] });
    expect(ids(byConfig)).toEqual([]);
    expect(byConfig.score).toBe(100);
  });

  it("honours rule overrides and ignorePaths", () => {
    expect(ids(scan(LEAKY, { rules: { "secrets/hardcoded-password": "off" } }))).not.toContain("secrets/hardcoded-password");
    const downgraded = scan(LEAKY, { rules: { "secrets/hardcoded-password": "nice-to-have" } });
    expect(downgraded.findings.find((f) => f.ruleId === "secrets/hardcoded-password")!.severity).toBe("nice-to-have");
    expect(ids(scan({ "legacy/a.js": `const password = "Sup3r-S3cret!";` }, { ignorePaths: ["legacy"] }))).toEqual([]);
    expect(ids(scan({ "a.test.js": `const password = "Sup3r-S3cret!";` }))).toEqual([]);
  });

  it("survives files with syntax errors", () => {
    const r = scan({ "broken.js": "function ( {{{ ;;; const = ", "ok.js": `const password = "Sup3r-S3cret!";` });
    expect(r.coverage.filesWithSyntaxErrors).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/broken\.js/);
    expect(ids(r)).toEqual(["secrets/hardcoded-password"]);
  });

  it("rejects invalid config", () => {
    expect(() => mergeConfig({ nope: 1 })).toThrow(ConfigError);
    expect(() => mergeConfig({ ignore: [{ ruleId: "x/y" }] })).toThrow(/reason/);
    expect(() => mergeConfig({ failUnder: 140 })).toThrow(ConfigError);
  });
});

describe("reports", () => {
  it("renders a self-contained HTML report that escapes content and carries the disclaimer", () => {
    const r = scan({ ...LEAKY, "package.json": JSON.stringify({ name: "<script>alert(1)</script>", dependencies: { express: "4" } }) });
    const html = renderHtml(r);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("not a security audit");
    expect(html).not.toContain("Sup3r-S3cret!");
  });

  it("renders Markdown with the checklist and findings", () => {
    const md = renderMarkdown(scan(LEAKY));
    expect(md).toContain("| GL-01 Secrets removed from repo | fail |");
    expect(md).toContain("auth/missing-on-sensitive-route");
    expect(md).toContain("not a security audit");
  });
});
