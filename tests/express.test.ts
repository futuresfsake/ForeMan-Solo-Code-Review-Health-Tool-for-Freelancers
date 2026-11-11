import { describe, expect, it } from "vitest";
import { buildExpressModel } from "../src/adapters/express.js";
import { loadProject, readPackageJson } from "../src/loader.js";
import { PKG, project } from "./helpers.js";

function model(files: Record<string, string>) {
  const dir = project({ "package.json": PKG, ...files });
  return buildExpressModel(loadProject(dir, ["node_modules"]).files, readPackageJson(dir));
}

const route = (m: ReturnType<typeof model>, method: string, path: string) => m.routes.find((r) => r.method === method && r.path === path);

describe("express adapter", () => {
  it("finds routes, params and route-level middleware", () => {
    const m = model({
      "app.js": `
        const express = require('express');
        const app = express();
        app.set('view engine', 'pug');
        app.get('view engine');
        app.get('/health', (req, res) => res.send('ok'));
        app.delete('/items/:id', requireAuth, [audit, limiter], (req, res) => res.end());
      `,
    });
    expect(m.detected).toBe(true);
    expect(m.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /health", "DELETE /items/:id"]);
    const del = route(m, "DELETE", "/items/:id")!;
    expect(del.params).toEqual(["id"]);
    expect(del.middleware).toEqual(["requireAuth", "audit", "limiter"]);
    expect(del.handler).toBeDefined();
    expect(m.entry).toEqual({ file: "app.js", line: 3 });
  });

  it("resolves router mounts across files with prefix and middleware", () => {
    const m = model({
      "src/app.ts": `
        import express from 'express';
        import helmet from 'helmet';
        import adminRouter from './routes/admin';
        import { requireAuth } from './middleware/auth';
        const app = express();
        app.use(helmet());
        app.use('/api/admin', requireAuth, adminRouter);
      `,
      "src/middleware/auth.ts": `export function requireAuth(req, res, next) { next(); }`,
      "src/routes/admin.ts": `
        import { Router } from 'express';
        const router = Router();
        router.get('/stats', (req, res) => res.json({}));
        router.use(auditLog);
        router.route('/users/:id').get(show).delete(remove);
        export default router;
      `,
    });
    expect(m.appMiddleware).toEqual(["helmet"]);
    // Mounted routes inherit what was registered on the app before the mount.
    expect(route(m, "GET", "/api/admin/stats")!.middleware).toEqual(["helmet", "requireAuth"]);
    // router.use() only applies to routes registered after it.
    expect(route(m, "DELETE", "/api/admin/users/:id")!.middleware).toEqual(["helmet", "requireAuth", "auditLog"]);
    expect(route(m, "GET", "/api/admin/users/:id")).toBeDefined();
  });

  it("applies path-scoped middleware to routes under that path", () => {
    const m = model({
      "app.js": `
        const express = require('express');
        const app = express();
        app.use('/admin', requireAdmin);
        app.get('/admin/users', (req, res) => res.end());
        app.get('/public', (req, res) => res.end());
      `,
    });
    expect(route(m, "GET", "/admin/users")!.middleware).toEqual(["requireAdmin"]);
    expect(route(m, "GET", "/public")!.middleware).toEqual([]);
  });

  it("does not treat an imported middleware file as a router mount", () => {
    const m = model({
      "app.js": `
        const express = require('express');
        const auth = require('./auth');
        const app = express();
        app.use(auth);
        app.get('/users', (req, res) => res.end());
      `,
      "auth.js": `module.exports = function auth(req, res, next) { next(); };`,
    });
    expect(m.appMiddleware).toEqual(["auth"]);
  });

  it("ignores HTTP-client calls and projects without express", () => {
    const m = model({
      "client.js": `
        const express = require('express');
        const api = makeClient();
        api.post('/users', payload);
      `,
    });
    expect(m.routes).toEqual([]);
    const dir = project({ "index.js": `router.get('/x', (req, res) => res.end());` });
    expect(buildExpressModel(loadProject(dir, []).files, null).detected).toBe(false);
  });
});
