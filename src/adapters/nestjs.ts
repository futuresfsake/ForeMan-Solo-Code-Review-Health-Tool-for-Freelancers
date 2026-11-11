import ts from "typescript";
import { lineOf, stringValue, walk } from "../ast.js";
import type { AdapterModel, ParsedFile, RouteInfo } from "../types.js";

const NEST_IMPORT = /from\s+['"]@nestjs\/(common|core)['"]|require\(\s*['"]@nestjs\/(common|core)['"]\s*\)/;
const HTTP_DECORATORS: Record<string, string> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
  All: "ALL",
  Head: "HEAD",
  Options: "OPTIONS",
};
/** Decorators whose arguments are middleware-like classes (guards, pipes, interceptors). */
const USE_DECORATORS = new Set(["UseGuards", "UsePipes", "UseInterceptors"]);
/** Single-decorator shortcuts that stand for a guard or limiter (`@Auth()`, `@Roles('admin')`). */
const MARKER_DECORATORS = new Set(["Auth", "Roles", "Permissions", "Throttle"]);
const GLOBAL_USES = new Set(["useGlobalGuards", "useGlobalPipes", "useGlobalInterceptors"]);
const APP_TOKENS = new Set(["APP_GUARD", "APP_PIPE", "APP_INTERCEPTOR"]);

interface Deco {
  name: string;
  args: readonly ts.Expression[];
  node: ts.Decorator;
}

function decoratorsOf(node: ts.Node): Deco[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).flatMap((d) => {
    const e = d.expression;
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) return [{ name: e.expression.text, args: [...e.arguments], node: d }];
    if (ts.isIdentifier(e)) return [{ name: e.text, args: [], node: d }];
    return [];
  });
}

function joinPath(...parts: string[]): string {
  const joined = `/${parts.join("/")}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

/** `JwtAuthGuard`, `new JwtAuthGuard()` and `AuthGuard('jwt')` all read as the name of the guard. */
function nameOf(expr: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isNewExpression(expr) || ts.isCallExpression(expr)) {
    const callee = expr.expression;
    const base = ts.isIdentifier(callee) ? callee.text : callee.getText(sf);
    // `AuthGuard('jwt')` is the passport guard; keep its argument so the name still says "jwt".
    const first = expr.arguments?.[0];
    const arg = first ? stringValue(first) : undefined;
    return arg ? `${base}:${arg}` : base;
  }
  return expr.getText(sf).slice(0, 60);
}

function middlewareOf(decos: Deco[], sf: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const d of decos) {
    if (USE_DECORATORS.has(d.name)) out.push(...d.args.map((a) => nameOf(a, sf)));
    else if (MARKER_DECORATORS.has(d.name)) out.push(d.name);
  }
  return out;
}

/** First string in `@Controller('x')`, `@Controller({ path: 'x' })` or `@Get(['a', 'b'])`. */
function pathOf(deco: Deco): string | undefined {
  const arg = deco.args[0];
  if (!arg) return "";
  const plain = stringValue(arg);
  if (plain !== undefined) return plain;
  if (ts.isArrayLiteralExpression(arg)) return stringValue(arg.elements[0]);
  if (ts.isObjectLiteralExpression(arg)) {
    for (const p of arg.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "path") {
        const v = stringValue(p.initializer);
        if (v !== undefined) return v;
        if (ts.isArrayLiteralExpression(p.initializer)) return stringValue(p.initializer.elements[0]);
      }
    }
    return "";
  }
  return undefined;
}

interface Setup {
  globalPrefix: string;
  middleware: string[];
  entry?: { file: string; line: number };
}

/** Reads bootstrap code (`NestFactory.create`, `app.use`, `app.useGlobal*`) and `APP_GUARD` style providers. */
function readSetup(files: ParsedFile[]): Setup {
  const setup: Setup = { globalPrefix: "", middleware: [] };
  for (const file of files) {
    const sf = file.ast;
    const apps = new Set<string>();
    walk(sf, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        let init = n.initializer;
        if (ts.isAwaitExpression(init)) init = init.expression;
        if (ts.isCallExpression(init) && /^NestFactory\.create\w*$/.test(init.expression.getText(sf))) {
          apps.add(n.name.text);
          setup.entry ??= { file: file.path, line: lineOf(sf, n) };
        }
      }
    });
    walk(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression)) {
        const recv = n.expression.expression.text;
        const method = n.expression.name.text;
        if (!apps.has(recv) && !/^app$/.test(recv)) return;
        if (method === "setGlobalPrefix") setup.globalPrefix = stringValue(n.arguments[0]) ?? setup.globalPrefix;
        else if (method === "use") setup.middleware.push(...[...n.arguments].map((a) => nameOf(a, sf)));
        else if (GLOBAL_USES.has(method)) setup.middleware.push(...[...n.arguments].map((a) => nameOf(a, sf)));
      }
      // { provide: APP_GUARD, useClass: JwtAuthGuard }
      if (ts.isObjectLiteralExpression(n)) {
        let token = false;
        let used: ts.Expression | undefined;
        for (const p of n.properties) {
          if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
          if (p.name.text === "provide" && ts.isIdentifier(p.initializer) && APP_TOKENS.has(p.initializer.text)) token = true;
          if (/^use(Class|Value|Factory|Existing)$/.test(p.name.text)) used = p.initializer;
        }
        if (token && used) setup.middleware.push(nameOf(used, sf));
      }
    });
  }
  setup.middleware = [...new Set(setup.middleware)];
  return setup;
}

/**
 * Builds the normalized route model for a NestJS project: controller routes with
 * the controller prefix and global prefix applied, and the guards, pipes and
 * limiters that apply to each one. Only the class and method decorators are
 * read; nothing is executed.
 */
export function buildNestModel(files: ParsedFile[], packageJson: Record<string, unknown> | null): AdapterModel {
  const deps = { ...(packageJson?.dependencies as object | undefined), ...(packageJson?.devDependencies as object | undefined) };
  const detected = "@nestjs/core" in deps || "@nestjs/common" in deps || files.some((f) => NEST_IMPORT.test(f.text));
  const model: AdapterModel = { detected, routes: [], appMiddleware: [], warnings: [] };
  if (!detected) return model;

  const setup = readSetup(files);
  model.appMiddleware = setup.middleware;
  model.entry = setup.entry;

  for (const file of files) {
    const sf = file.ast;
    walk(sf, (n) => {
      if (!ts.isClassDeclaration(n)) return;
      const classDecos = decoratorsOf(n);
      const controller = classDecos.find((d) => d.name === "Controller");
      if (!controller) return;
      const prefix = pathOf(controller);
      if (prefix === undefined) {
        model.warnings.push(`${file.path}:${lineOf(sf, n)}: controller path is not a plain string; its routes were skipped.`);
        return;
      }
      const classMw = middlewareOf(classDecos, sf);
      for (const member of n.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const decos = decoratorsOf(member);
        const http = decos.find((d) => d.name in HTTP_DECORATORS);
        if (!http) continue;
        const sub = pathOf(http);
        if (sub === undefined) {
          model.warnings.push(`${file.path}:${lineOf(sf, member)}: route path is not a plain string; checks for this route may be incomplete.`);
        }
        const full = joinPath(setup.globalPrefix, prefix, sub ?? "<dynamic>");
        const route: RouteInfo = {
          method: HTTP_DECORATORS[http.name]!,
          path: full,
          file: file.path,
          line: lineOf(sf, member),
          params: [...full.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!),
          middleware: [...new Set([...classMw, ...middlewareOf(decos, sf)])],
          // Nest reads input through parameter decorators, not `req`, so the
          // Express-shaped input check has nothing to inspect (see known-gaps.md).
          handler: undefined,
          handlerRef: member.name.getText(sf),
        };
        model.routes.push(route);
      }
    });
  }

  model.routes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.path.localeCompare(b.path));
  return model;
}
