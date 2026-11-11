import { describe, expect, it } from "vitest";
import { parseAuditJson } from "../src/rules/deps.js";
import { FAKE, PKG, ids, scan } from "./helpers.js";

const APP = `const express = require('express');\nconst helmet = require('helmet');\nconst app = express();\napp.use(helmet());\n`;
const app = (body: string) => ({ "package.json": PKG, "package-lock.json": "{}", "app.js": APP + body });

describe("secrets", () => {
  it("flags well-known key formats and redacts them", () => {
    const r = scan({ "config.js": `module.exports = { aws: "${FAKE.aws}", stripe: '${FAKE.stripe}' };\n// ${FAKE.github}` });
    const found = r.findings.filter((f) => f.ruleId === "secrets/hardcoded-api-key");
    expect(found.map((f) => f.line)).toEqual([1, 2]);
    expect(JSON.stringify(r)).not.toContain(FAKE.aws);
    expect(found[0]!.message).toContain("AKIA…");
  });

  it("flags hardcoded passwords, including env fallbacks", () => {
    const r = scan({
      "db.js": `
        const dbPassword = "Sup3r-S3cret!";
        const jwt = { secret: process.env.JWT_SECRET || "dev-K3y-91xz" };
      `,
    });
    expect(ids(r).filter((i) => i === "secrets/hardcoded-password")).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain("Sup3r-S3cret!");
  });

  it("does not flag names, placeholders, URLs or env lookups", () => {
    const r = scan({
      "ok.js": `
        const password = process.env.DB_PASSWORD;
        const tokenHeader = "x-access-token";
        const apiKey = "your-api-key-here";
        const secretName = "prod/Database-01";
        const passwordResetUrl = "https://example.test/Reset-1";
        const token = "authorization";
      `,
    });
    expect(ids(r)).toEqual([]);
  });

  it("flags an env file that is not git-ignored, but not an example or an ignored one", () => {
    expect(ids(scan({ ".env": "A=1" }))).toContain("secrets/committed-env");
    expect(ids(scan({ ".env": "A=1", ".gitignore": "node_modules\n.env\n" }))).not.toContain("secrets/committed-env");
    expect(ids(scan({ ".env.example": "A=" }))).not.toContain("secrets/committed-env");
  });
});

describe("injection/sql-concat", () => {
  it("flags concatenation and template interpolation, with higher confidence for request data", () => {
    const r = scan({
      "repo.js": `
        async function a(db, req) { return db.query("SELECT * FROM users WHERE id = " + req.params.id); }
        async function b(db, name) { return db.query(\`SELECT * FROM users WHERE name = '\${name}'\`); }
        async function c(db, req) { const sql = "DELETE FROM users WHERE id = " + req.body.id; return db.execute(sql); }
      `,
    });
    const found = r.findings.filter((f) => f.ruleId === "injection/sql-concat");
    expect(found.map((f) => [f.line, f.confidence])).toEqual([[2, "high"], [3, "medium"], [4, "high"]]);
  });

  it("does not flag parameterized queries, tagged templates or non-SQL strings", () => {
    const r = scan({
      "repo.js": `
        async function a(db, id) { return db.query("SELECT * FROM users WHERE id = $1", [id]); }
        async function b(sql, id) { return sql\`SELECT * FROM users WHERE id = \${id}\`; }
        function c(cache, id) { return cache.get("user:" + id); }
        function d(el, name) { return el.query(\`.item-\${name}\`); }
      `,
    });
    expect(ids(r)).toEqual([]);
  });
});

describe("auth/missing-on-sensitive-route", () => {
  it("flags sensitive paths as blockers and other writes as low-confidence should-fix", () => {
    const r = scan(app(`
      app.delete('/admin/users/:id', (req, res) => res.end());
      app.post('/orders', validate(schema), (req, res) => res.end());
    `));
    const found = r.findings.filter((f) => f.ruleId === "auth/missing-on-sensitive-route");
    expect(found.map((f) => [f.severity, f.confidence])).toEqual([["blocker", "medium"], ["should-fix", "low"]]);
  });

  it("accepts route, router and app level auth, public paths and configured names", () => {
    expect(ids(scan(app(`app.delete('/admin/users/:id', requireAuth, (req, res) => res.end());`)))).toEqual([]);
    expect(ids(scan(app(`app.use(passport.authenticate('jwt'));\napp.get('/admin', (req, res) => res.end());`)))).toEqual([]);
    expect(ids(scan(app(`app.post('/login', loginLimiter, validate(s), (req, res) => res.end());`)))).toEqual([]);
    expect(ids(scan(app(`app.get('/admin', mustBeStaff, (req, res) => res.end());`), { authMiddlewareNames: ["mustBeStaff"] }))).toEqual([]);
  });

  it("does not count passport.initialize or a rate limiter as authentication", () => {
    const r = scan(app(`app.use(passport.initialize());\napp.get('/admin', authLimiter, (req, res) => res.end());`));
    expect(ids(r)).toContain("auth/missing-on-sensitive-route");
  });
});

describe("validation/unvalidated-param", () => {
  it("flags a handler that reads request input with no validation", () => {
    const r = scan(app(`app.get('/items/:id', (req, res) => res.json(db.find(req.params.id)));`));
    expect(ids(r)).toEqual(["validation/unvalidated-param"]);
  });

  it("accepts validation middleware, in-handler validation and named handlers in the file", () => {
    expect(ids(scan(app(`app.get('/items/:id', validate(schema), (req, res) => res.json(req.params.id));`)))).toEqual([]);
    expect(ids(scan(app(`app.get('/items/:id', (req, res) => res.json(schema.parse(req.params)));`)))).toEqual([]);
    const named = scan(app(`function show(request, res) { res.json(request.query.q); }\napp.get('/items', show);`));
    expect(ids(named)).toEqual(["validation/unvalidated-param"]);
  });
});

describe("config rules", () => {
  it("flags development start scripts and hardcoded dev env", () => {
    const pkg = JSON.stringify({ name: "x", dependencies: { express: "4" }, scripts: { start: "nodemon server.js" } });
    const r = scan({ "package.json": pkg, "package-lock.json": "{}", "app.js": `${APP}app.set('env', 'development');` });
    expect(ids(r).filter((i) => i === "config/debug-enabled")).toHaveLength(2);
    expect(ids(scan(app(``)))).toEqual([]);
  });

  it("flags missing HTTPS enforcement with low confidence, and accepts helmet", () => {
    const r = scan({ "package.json": PKG, "package-lock.json": "{}", "app.js": `const express = require('express');\nconst app = express();\napp.get('/', (req, res) => res.end());` });
    const f = r.findings.find((x) => x.ruleId === "config/no-https-redirect")!;
    expect([f.confidence, f.file, f.line]).toEqual(["low", "app.js", 2]);
    expect(ids(scan(app(`app.get('/', (req, res) => res.end());`)))).toEqual([]);
  });

  it("flags open CORS and accepts an explicit origin", () => {
    const r = scan(app(`app.use(cors());\napp.use(cors({ origin: '*', credentials: true }));\nres.setHeader('Access-Control-Allow-Origin', '*');`));
    const found = r.findings.filter((f) => f.ruleId === "config/permissive-cors");
    expect(found.map((f) => f.confidence)).toEqual(["medium", "high", "medium"]);
    expect(ids(scan(app(`app.use(cors({ origin: ['https://shop.example'] }));`)))).toEqual([]);
  });

  it("flags default credentials in assignments, env fallbacks and connection strings", () => {
    const r = scan({
      "config.js": `
        const config = { password: "admin" };
        const secret = process.env.SESSION_SECRET || "secret";
        const url = "postgres://postgres:postgres@localhost/app";
      `,
    });
    expect(ids(r)).toEqual(["config/default-credentials", "config/default-credentials", "config/default-credentials"]);
  });

  it("flags stack traces sent to the client, not ones that are only logged", () => {
    const r = scan(app(`app.use((err, req, res, next) => { res.status(500).json({ error: err.message, stack: err.stack }); });`));
    expect(ids(r)).toEqual(["config/stack-trace-leak"]);
    expect(ids(scan(app(`app.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ error: 'Server error' }); });`)))).toEqual([]);
  });

  it("flags auth routes without a rate limiter", () => {
    expect(ids(scan(app(`app.post('/login', validate(s), (req, res) => res.end());`)))).toEqual(["config/no-rate-limit-auth"]);
    expect(ids(scan(app(`app.use(rateLimit({ max: 100 }));\napp.post('/login', validate(s), (req, res) => res.end());`)))).toEqual([]);
  });
});

describe("deps", () => {
  const auditJson = JSON.stringify({
    vulnerabilities: {
      lodash: { severity: "high", range: "<4.17.21", via: [{ title: "Command Injection" }], fixAvailable: true },
      debug: { severity: "low", range: "<2.6.9", via: ["ms"], fixAvailable: false },
    },
  });

  it("parses npm audit output", () => {
    const out = parseAuditJson(auditJson);
    expect(out.ok && out.vulnerabilities.map((v) => [v.name, v.severity, v.title])).toEqual([["debug", "low", undefined], ["lodash", "high", "Command Injection"]]);
    expect(parseAuditJson("not json").ok).toBe(false);
    expect(parseAuditJson(JSON.stringify({ error: { code: "ENOTFOUND" } })).ok).toBe(false);
  });

  it("turns vulnerabilities into findings with mapped severity", () => {
    const r = scan({ "package.json": PKG, "package-lock.json": "{}" }, {}, () => parseAuditJson(auditJson));
    expect(r.findings.filter((f) => f.ruleId === "deps/vulnerable").map((f) => f.severity)).toEqual(["blocker", "nice-to-have"]);
    expect(r.coverage.rulesRun).toContain("deps/vulnerable");
  });

  it("reports the audit as skipped when disabled, failed or not auditable", () => {
    const skipped = (r: ReturnType<typeof scan>) => r.coverage.rulesSkipped.find((s) => s.id === "deps/vulnerable")?.reason;
    expect(skipped(scan({ "package.json": PKG, "package-lock.json": "{}" }))).toMatch(/disabled/);
    expect(skipped(scan({ "package.json": PKG, "package-lock.json": "{}" }, {}, () => ({ ok: false, reason: "offline" })))).toBe("offline");
    expect(skipped(scan({ "package.json": PKG, "yarn.lock": "" }, {}, () => ({ ok: true, vulnerabilities: [] })))).toMatch(/npm lockfiles/);
  });

  it("flags a missing lockfile", () => {
    expect(ids(scan({ "package.json": PKG }))).toContain("deps/no-lockfile");
  });
});
