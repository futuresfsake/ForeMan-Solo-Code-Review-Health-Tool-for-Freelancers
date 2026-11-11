import { describe, expect, it } from "vitest";
import { buildNestModel } from "../src/adapters/nestjs.js";
import { loadProject, readPackageJson } from "../src/loader.js";
import { ids, project, scan } from "./helpers.js";

const NEST_PKG = JSON.stringify({ name: "nest-fixture", dependencies: { "@nestjs/core": "^10.0.0", "@nestjs/common": "^10.0.0" } });

function model(files: Record<string, string>) {
  const dir = project({ "package.json": NEST_PKG, ...files });
  return buildNestModel(loadProject(dir, ["node_modules"]).files, readPackageJson(dir));
}

const FILES = {
  "src/main.ts": `
    import { NestFactory } from '@nestjs/core';
    async function bootstrap() {
      const app = await NestFactory.create(AppModule);
      app.setGlobalPrefix('api');
      await app.listen(3000);
    }
  `,
  "src/orders.controller.ts": `
    import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
    @Controller('orders')
    export class OrdersController {
      @Get(':id')
      findOne(@Param('id') id: string) { return id; }

      @UseGuards(JwtAuthGuard)
      @Delete(':id')
      remove(@Param('id') id: string) { return id; }
    }
  `,
  "src/auth.controller.ts": `
    import { Controller, Post } from '@nestjs/common';
    @Controller({ path: 'auth' })
    export class AuthController {
      @Post('login')
      login() {}
    }
  `,
};

describe("nestjs adapter", () => {
  it("finds controller routes with the global prefix, params and guards", () => {
    const m = model(FILES);
    expect(m.detected).toBe(true);
    expect(m.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/auth/login", "GET /api/orders/:id", "DELETE /api/orders/:id"]);
    const del = m.routes.find((r) => r.method === "DELETE")!;
    expect(del.params).toEqual(["id"]);
    expect(del.middleware).toEqual(["JwtAuthGuard"]);
    expect(m.routes.find((r) => r.method === "GET")!.middleware).toEqual([]);
    expect(m.entry).toEqual({ file: "src/main.ts", line: 4 });
  });

  it("applies class-level guards to every route in the controller", () => {
    const m = model({
      "a.controller.ts": `
        @UseGuards(AuthGuard('jwt'))
        @Controller('admin')
        export class A { @Get('stats') stats() {} @Post() make() {} }
      `,
    });
    expect(m.routes.map((r) => [r.path, r.middleware])).toEqual([
      ["/admin", ["AuthGuard:jwt"]],
      ["/admin/stats", ["AuthGuard:jwt"]],
    ]);
  });

  it("treats APP_GUARD providers and useGlobalGuards as app-wide middleware", () => {
    const m = model({
      "app.module.ts": `@Module({ providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] }) export class AppModule {}`,
      "main.ts": `const app = await NestFactory.create(M); app.useGlobalPipes(new ValidationPipe());`,
    });
    expect(m.appMiddleware).toEqual(["JwtAuthGuard", "ValidationPipe"]);
  });

  it("does not detect a plain Express project", () => {
    const dir = project({ "package.json": JSON.stringify({ dependencies: { express: "4" } }), "app.js": "const express = require('express');" });
    expect(buildNestModel(loadProject(dir, []).files, readPackageJson(dir)).detected).toBe(false);
  });
});

describe("shared rules on a Nest project", () => {
  it("fires auth and rate-limit findings with no rule changes (must-fire)", () => {
    const result = scan({
      "package.json": NEST_PKG,
      ...FILES,
      "src/admin.controller.ts": `
        @Controller('admin')
        export class AdminController { @Get('stats') stats() {} }
      `,
    });
    expect(result.project.framework).toBe("nestjs");
    const auth = result.findings.filter((f) => f.ruleId === "auth/missing-on-sensitive-route" && !f.suppressed);
    expect(auth.map((f) => f.message)).toEqual(['GET /api/admin/stats is under "/admin" and has no authentication middleware.']);
    expect(ids(result)).toContain("config/no-rate-limit-auth");
    expect(result.coverage.rulesSkipped.map((r) => r.id)).not.toContain("auth/missing-on-sensitive-route");
  });

  it("stays quiet when guards and a limiter are present (must-not-fire)", () => {
    const result = scan({
      "package.json": NEST_PKG,
      "src/main.ts": `const app = await NestFactory.create(M); app.useGlobalGuards(new JwtAuthGuard());`,
      "src/auth.controller.ts": `
        @Controller('auth')
        export class AuthController {
          @UseGuards(ThrottlerGuard)
          @Post('login')
          login() {}
        }
      `,
      "src/orders.controller.ts": `
        @Controller('orders')
        export class OrdersController { @Get(':id') one() {} @Delete(':id') del() {} }
      `,
    });
    expect(ids(result)).not.toContain("auth/missing-on-sensitive-route");
    expect(ids(result)).not.toContain("config/no-rate-limit-auth");
  });
});
