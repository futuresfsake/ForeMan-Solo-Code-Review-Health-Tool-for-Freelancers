// Regression tests for patterns found while validating against real
// open-source Express apps (see docs/testing/validation-results.md).
import { describe, expect, it } from "vitest";
import { buildExpressModel } from "../src/adapters/express.js";
import { loadProject, readPackageJson } from "../src/loader.js";
import { PKG, ids, project, scan } from "./helpers.js";

function routes(files: Record<string, string>): string[] {
  const dir = project({ "package.json": PKG, ...files });
  const model = buildExpressModel(loadProject(dir, ["node_modules"]).files, readPackageJson(dir));
  return model.routes.map((r) => `${r.method} ${r.path} [${r.middleware.join(",")}]`);
}

describe("express adapter: real-world mounting styles", () => {
  it("resolves routers mounted from a table of { path, route } objects in a loop", () => {
    const found = routes({
      "app.js": `
        const express = require('express');
        const routes = require('./routes');
        const { authLimiter } = require('./limiter');
        const app = express();
        app.use('/v1/auth', authLimiter);
        app.use('/v1', routes);
      `,
      "limiter.js": `module.exports = { authLimiter: (req, res, next) => next() };`,
      "routes/index.js": `
        const express = require('express');
        const authRoute = require('./auth.route');
        const userRoute = require('./user.route');
        const router = express.Router();
        const defaultRoutes = [
          { path: '/auth', route: authRoute },
          { path: '/users', route: userRoute },
        ];
        defaultRoutes.forEach((route) => { router.use(route.path, route.route); });
        module.exports = router;
      `,
      "routes/auth.route.js": `
        const router = require('express').Router();
        router.post('/login', validate(schema), controller.login);
        module.exports = router;
      `,
      "routes/user.route.js": `
        const router = require('express').Router();
        router.route('/:userId').get(auth('getUsers'), controller.getUser);
        module.exports = router;
      `,
    });
    expect(found).toEqual(["POST /v1/auth/login [validate,authLimiter]", "GET /v1/users/:userId [auth]"]);
  });

  it("resolves chained Router().use() calls and routers mounted on routers in the same file", () => {
    const found = routes({
      "main.ts": `
        import express from 'express';
        import routes from './routes';
        const app = express();
        app.use(routes);
      `,
      "routes.ts": `
        import { Router } from 'express';
        import articles from './articles';
        import users from './users';
        const api = Router().use(articles).use(users);
        export default Router().use('/api', api);
      `,
      "articles.ts": `
        import { Router } from 'express';
        const router = Router();
        router.get('/articles', auth.optional, (req, res) => res.json([]));
        export default router;
      `,
      "users.ts": `
        import { Router } from 'express';
        const router = Router();
        router.post('/users', (req, res) => res.json({}));
        export default router;
      `,
    });
    expect(found).toEqual(["GET /api/articles [auth.optional]", "POST /api/users []"]);
  });
});

describe("rules: real-world false positives and misses", () => {
  const APP = `const express = require('express');\nconst helmet = require('helmet');\nconst app = express();\napp.use(helmet());\n`;
  const app = (body: string) => ({ "package.json": PKG, "package-lock.json": "{}", "app.js": APP + body });

  it("flags eval and new Function on request data", () => {
    const r = scan(app(`
      app.post('/calc', requireAuth, validate(s), (req, res) => { res.json(eval(req.body.expr)); });
      const f = new Function(userCode);
      const two = eval("1 + 1");
    `));
    const found = r.findings.filter((f) => f.ruleId === "injection/code-eval");
    expect(found.map((f) => [f.line, f.confidence])).toEqual([[6, "high"], [7, "medium"]]);
  });

  it("does not treat an enum of token types as hardcoded secrets", () => {
    const r = scan({ "tokens.js": `module.exports = { ACCESS: 'access', RESET_PASSWORD: 'resetPassword', VERIFY_EMAIL: 'verifyEmail' };\nconst passwordLabel = "Password";\nconst secretQuestion = "MotherMaidenName";` });
    expect(ids(r)).toEqual([]);
  });

  it("still flags a letters-only fallback for a secret environment variable", () => {
    const r = scan({ "auth.ts": `const secret = process.env.JWT_SECRET || 'superSecret';` });
    expect(ids(r)).toEqual(["secrets/hardcoded-password"]);
  });

  it("ignores test folders and fixtures by default", () => {
    const leak = `const password = "Sup3r-S3cret!";`;
    expect(ids(scan({ "tests/fixtures/user.fixture.js": leak, "test/security/profile.js": leak, "cypress/login.js": leak }))).toEqual([]);
    expect(ids(scan({ "src/test.js": leak }))).toEqual(["secrets/hardcoded-password"]);
  });

  it("treats hyphenated auth paths as public and does not count optional auth as auth", () => {
    expect(ids(scan(app(`app.use(limiter);\napp.post('/forgot-password', validate(s), h);\napp.post('/refresh-tokens', validate(s), h);\napp.post('/verify-email', validate(s), h);`)))).toEqual([]);
    expect(ids(scan(app(`app.delete('/admin/users/:id', auth.optional, validate(s), (req, res) => res.end());`)))).toEqual(["auth/missing-on-sensitive-route"]);
    // "/auth" must not make "/authors" public.
    expect(ids(scan(app(`app.post('/authors', validate(s), (req, res) => res.end());`)))).toEqual(["auth/missing-on-sensitive-route"]);
  });

  it("hedges an open POST on the users collection as possible sign-up", () => {
    const f = scan(app(`app.use(limiter);\napp.post('/api/users', validate(s), (req, res) => res.end());`)).findings[0]!;
    expect([f.ruleId, f.severity, f.confidence]).toEqual(["auth/missing-on-sensitive-route", "should-fix", "low"]);
    expect(f.message).toMatch(/sign-up/);
  });

  it("reports unvalidated path parameters with low confidence, body and query with medium", () => {
    const r = scan(app(`
      app.get('/a/:id', (req, res) => res.json(find(req.params.id)));
      app.get('/b', (req, res) => res.json(search(req.query)));
    `));
    expect(r.findings.filter((f) => f.ruleId === "validation/unvalidated-param").map((f) => f.confidence)).toEqual(["low", "medium"]);
  });

  it("does not accept commented-out code as HTTPS evidence", () => {
    const r = scan({
      "package.json": PKG,
      "package-lock.json": "{}",
      "server.js": `const express = require('express');\n// const helmet = require("helmet");\n/* app.use(helmet.hsts()); */\nconst app = express();\napp.get('/', (req, res) => res.end());`,
    });
    expect(ids(r)).toEqual(["config/no-https-redirect"]);
  });

  it("reports an option-less cors() once per file", () => {
    const r = scan(app(`app.use(cors());\napp.options('*', cors());`));
    expect(ids(r)).toEqual(["config/permissive-cors"]);
  });
});
