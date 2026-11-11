import path from "node:path";
import ts from "typescript";
import { isFunctionLike, lineOf, stringValue, walk } from "../ast.js";
import type { ParsedFile, RouteInfo } from "../types.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "head", "options"]);
const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const FALLBACK_APP = /^(app|server)$/;
const FALLBACK_ROUTER = /^(router|routes)$|(Router|Routes)$/;
const IMPORTS_EXPRESS = /from\s+['"]express['"]|require\(\s*['"]express['"]\s*\)/;
const MAX_CONTEXTS = 8;

type Kind = "app" | "router";

interface RawRoute {
  method: string;
  path: string;
  line: number;
  pos: number;
  receiver: string;
  middleware: string[];
  handler?: ts.Node;
  handlerRef: string;
}

interface UseArg {
  name: string;
  /** Absolute path of the project file this argument was imported from. */
  target?: string;
  /** Name of a router created in the same file, e.g. `Router().use('/api', api)`. */
  local?: string;
}

interface UseCall {
  pos: number;
  receiver: string;
  kind: Kind;
  prefix?: string;
  args: UseArg[];
}

interface FileInfo {
  file: ParsedFile;
  routes: RawRoute[];
  uses: UseCall[];
  entryLine?: number;
}

interface MountContext {
  prefix: string;
  middleware: string[];
}

export interface ExpressModel {
  detected: boolean;
  routes: RouteInfo[];
  appMiddleware: string[];
  entry?: { file: string; line: number };
  warnings: string[];
}

function resolveSpec(fromAbs: string, spec: string, byAbs: Map<string, ParsedFile>): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(fromAbs), spec);
  const candidates = [base, ...SOURCE_EXTS.map((e) => base + e), ...SOURCE_EXTS.map((e) => path.join(base, `index${e}`))];
  // TypeScript ESM projects import "./x.js" for a file that is "./x.ts".
  if (/\.[cm]?js$/.test(base)) candidates.push(base.replace(/\.([cm]?)js$/, ".$1ts"));
  return candidates.find((c) => byAbs.has(c));
}

function requireSpec(init: ts.Expression): string | undefined {
  let cur = init;
  while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  if (ts.isCallExpression(cur) && ts.isIdentifier(cur.expression) && cur.expression.text === "require") {
    return stringValue(cur.arguments[0]);
  }
  return undefined;
}

/**
 * Finds the `express()` or `Router()` call at the bottom of a chain such as
 * `Router().use(a).use('/api', b)`.
 */
function creationRoot(expr: ts.Expression, sf: ts.SourceFile): { call: ts.Node; kind: Kind } | undefined {
  let cur = expr;
  while (ts.isCallExpression(cur) || ts.isNewExpression(cur)) {
    const callee = cur.expression;
    const text = callee.getText(sf);
    if (text === "express") return { call: cur, kind: "app" };
    if (/(^|\.)Router$/.test(text)) return { call: cur, kind: "router" };
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    if (callee.name.text !== "use" && !HTTP_METHODS.has(callee.name.text)) return undefined;
    cur = callee.expression;
  }
  return undefined;
}

function flatten(args: readonly ts.Expression[]): ts.Expression[] {
  return args.flatMap((a) => (ts.isArrayLiteralExpression(a) ? flatten(a.elements) : [a]));
}

function argName(arg: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isIdentifier(arg)) return arg.text;
  if (ts.isCallExpression(arg)) return arg.expression.getText(sf);
  if (isFunctionLike(arg)) return "<inline>";
  return arg.getText(sf).slice(0, 60);
}

function joinPath(a: string, b: string): string {
  const joined = `${a}/${b}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

function analyzeFile(file: ParsedFile, byAbs: Map<string, ParsedFile>, warnings: string[]): FileInfo {
  const sf = file.ast;
  const info: FileInfo = { file, routes: [], uses: [] };
  const receivers = new Map<string, Kind>();
  const imports = new Map<string, string>();
  const functions = new Map<string, ts.Node>();
  /** Start position of an `express()`/`Router()` call -> the variable it was assigned to. */
  const creationNames = new Map<number, string>();
  /** `router.use(item.path, item.route)` inside a loop over a route table. */
  let tableUse: { pos: number; receiver: string; kind: Kind } | undefined;

  const bindRequire = (name: ts.BindingName, spec: string): void => {
    const target = resolveSpec(file.abs, spec, byAbs);
    if (!target) return;
    if (ts.isIdentifier(name)) imports.set(name.text, target);
    else if (ts.isObjectBindingPattern(name)) {
      for (const el of name.elements) if (ts.isIdentifier(el.name)) imports.set(el.name.text, target);
    }
  };

  walk(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause) {
      const target = resolveSpec(file.abs, n.moduleSpecifier.text, byAbs);
      if (!target) return;
      const clause = n.importClause;
      if (clause.name) imports.set(clause.name.text, target);
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) imports.set(named.name.text, target);
      else if (named) for (const el of named.elements) imports.set(el.name.text, target);
      return;
    }
    if (ts.isFunctionDeclaration(n) && n.name) functions.set(n.name.text, n);
    if (!ts.isVariableDeclaration(n) || !n.initializer) return;
    const init = n.initializer;
    const spec = requireSpec(init);
    if (spec) bindRequire(n.name, spec);
    if (!ts.isIdentifier(n.name)) return;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) functions.set(n.name.text, init);
    const created = creationRoot(init, sf);
    if (created) {
      receivers.set(n.name.text, created.kind);
      creationNames.set(created.call.getStart(sf), n.name.text);
      if (created.kind === "app") info.entryLine ??= lineOf(sf, n);
    }
  });

  const kindOf = (name: string): Kind | undefined =>
    receivers.get(name) ?? (FALLBACK_APP.test(name) ? "app" : FALLBACK_ROUTER.test(name) ? "router" : undefined);

  /** The app or router a call chain hangs off: `app`, or an inline `Router()`. */
  const rootOf = (expr: ts.Expression): { name: string; kind: Kind } | undefined => {
    let cur = expr;
    while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
      const name = cur.expression.name.text;
      if (name !== "use" && !HTTP_METHODS.has(name)) break;
      cur = cur.expression.expression;
    }
    if (ts.isIdentifier(cur)) {
      const kind = kindOf(cur.text);
      return kind ? { name: cur.text, kind } : undefined;
    }
    const created = creationRoot(cur, sf);
    if (!created) return undefined;
    const pos = created.call.getStart(sf);
    return { name: creationNames.get(pos) ?? `<inline@${pos}>`, kind: created.kind };
  };

  /** The project file an argument was imported from, if any. */
  const importTarget = (arg: ts.Expression): string | undefined => {
    if (ts.isIdentifier(arg)) return imports.get(arg.text);
    const spec = requireSpec(arg);
    return spec ? resolveSpec(file.abs, spec, byAbs) : undefined;
  };

  const addRoute = (method: string, routePath: string, receiver: string, handlerArgs: ts.Expression[], node: ts.Node): void => {
    const flat = flatten(handlerArgs);
    const last = flat.pop();
    let handler: ts.Node | undefined;
    if (last && isFunctionLike(last)) handler = last;
    else if (last && ts.isIdentifier(last)) handler = functions.get(last.text);
    info.routes.push({
      method: method.toUpperCase(),
      path: routePath,
      line: lineOf(sf, node),
      pos: node.getStart(sf),
      receiver,
      middleware: flat.map((a) => argName(a, sf)),
      handler,
      handlerRef: last ? argName(last, sf) : "<none>",
    });
  };

  /** Finds the `X.route('/p')` at the bottom of `X.route('/p').get(h).post(h)`. */
  const routeChainBase = (expr: ts.Expression): { path: string; receiver: string } | undefined => {
    let cur = expr;
    while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
      const name = cur.expression.name.text;
      const obj = cur.expression.expression;
      if (name === "route" && ts.isIdentifier(obj) && kindOf(obj.text)) {
        return { path: stringValue(cur.arguments[0]) ?? "<dynamic>", receiver: obj.text };
      }
      if (!HTTP_METHODS.has(name)) return undefined;
      cur = obj;
    }
    return undefined;
  };

  walk(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const method = n.expression.name.text;
    const target = n.expression.expression;

    if (method === "use") {
      const root = rootOf(target);
      if (!root) return;
      const args = [...n.arguments];
      // `router.use(item.path, item.route)`: the real mounts are in a table of
      // { path, route } objects elsewhere in the file.
      if (args.length >= 2 && args.every((a) => ts.isPropertyAccessExpression(a) && ts.isIdentifier(a.expression))) {
        tableUse ??= { pos: n.getStart(sf), receiver: root.name, kind: root.kind };
        return;
      }
      const prefix = stringValue(args[0]);
      if (prefix !== undefined) args.shift();
      const useArgs: UseArg[] = flatten(args).map((a) => ({
        name: argName(a, sf),
        target: importTarget(a),
        local: ts.isIdentifier(a) && receivers.has(a.text) && a.text !== root.name ? a.text : undefined,
      }));
      info.uses.push({ pos: n.getStart(sf), receiver: root.name, kind: root.kind, prefix, args: useArgs });
      return;
    }

    if (!HTTP_METHODS.has(method)) return;

    const chained = ts.isIdentifier(target) ? undefined : routeChainBase(target);
    if (chained) {
      if (n.arguments.length > 0) addRoute(method, chained.path, chained.receiver, [...n.arguments], n);
      return;
    }

    const root = rootOf(target);
    if (root) {
      const explicit = !ts.isIdentifier(target) || receivers.has(target.text);
      const args = [...n.arguments];
      // `app.get('view engine')` reads a setting; it is not a route.
      if (args.length < 2) return;
      const routePath = stringValue(args[0]);
      if (routePath === undefined) {
        if (!explicit) return;
        warnings.push(`${file.path}:${lineOf(sf, n)}: route path is not a plain string; checks for this route may be incomplete.`);
      } else if (!explicit && !/^[/*]/.test(routePath)) {
        return;
      }
      addRoute(method, routePath ?? "<dynamic>", root.name, args.slice(1), n);
    }
  });

  if (tableUse) {
    const { pos, receiver, kind } = tableUse;
    walk(sf, (n) => {
      if (!ts.isObjectLiteralExpression(n)) return;
      let prefix: string | undefined;
      let mounted: ts.Expression | undefined;
      for (const p of n.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
        if (p.name.text === "path") prefix = stringValue(p.initializer);
        else if (/^(route|router|routes|handler)$/.test(p.name.text)) mounted = p.initializer;
      }
      const target = mounted ? importTarget(mounted) : undefined;
      if (prefix === undefined || !mounted || !target) return;
      info.uses.push({ pos, receiver, kind, prefix, args: [{ name: argName(mounted, sf), target }] });
    });
  }

  return info;
}

/**
 * Builds the normalized route model for an Express project: routes with full
 * paths (router mounts resolved across files) and the middleware that applies
 * to each one.
 */
export function buildExpressModel(files: ParsedFile[], packageJson: Record<string, unknown> | null): ExpressModel {
  const deps = { ...(packageJson?.dependencies as object | undefined), ...(packageJson?.devDependencies as object | undefined) };
  const detected = "express" in deps || files.some((f) => IMPORTS_EXPRESS.test(f.text));
  const model: ExpressModel = { detected, routes: [], appMiddleware: [], warnings: [] };
  if (!detected) return model;

  const byAbs = new Map(files.map((f) => [f.abs, f]));
  const infos = new Map(files.map((f) => [f.abs, analyzeFile(f, byAbs, model.warnings)]));
  const isRouterFile = (abs: string): boolean => {
    const info = infos.get(abs);
    return !!info && (info.routes.length > 0 || info.uses.length > 0);
  };
  const isFileMount = (arg: UseArg, from: string): boolean => !!arg.target && arg.target !== from && isRouterFile(arg.target);
  const isMount = (arg: UseArg, from: string): boolean => !!arg.local || isFileMount(arg, from);

  /** Middleware registered with a path-less `use()` on the same receiver, earlier in the file. */
  const fileLevel = (info: FileInfo, receiver: string, pos: number): string[] =>
    info.uses
      .filter((u) => u.receiver === receiver && u.prefix === undefined && u.pos < pos)
      .flatMap((u) => u.args.filter((a) => !isMount(a, info.file.abs)).map((a) => a.name));

  /** Prefix and middleware a router gets from being mounted on another router in the same file. */
  const localContext = (info: FileInfo, receiver: string, depth = 0): MountContext => {
    const parent = info.uses.find((u) => u.receiver !== receiver && u.args.some((a) => a.local === receiver));
    if (!parent || depth > 4) return { prefix: "", middleware: [] };
    const outer = localContext(info, parent.receiver, depth + 1);
    return {
      prefix: joinPath(outer.prefix, parent.prefix ?? ""),
      middleware: [
        ...outer.middleware,
        ...fileLevel(info, parent.receiver, parent.pos),
        ...parent.args.filter((a) => !isMount(a, info.file.abs)).map((a) => a.name),
      ],
    };
  };

  interface Mount extends MountContext {
    from: string;
    to: string;
  }
  const mounts: Mount[] = [];
  const scoped: { from: string; prefix: string; names: string[] }[] = [];

  for (const info of infos.values()) {
    const abs = info.file.abs;
    for (const use of info.uses) {
      const names = use.args.filter((a) => !isMount(a, abs)).map((a) => a.name);
      const targets = use.args.filter((a) => isFileMount(a, abs));
      const local = localContext(info, use.receiver);
      for (const t of targets) {
        mounts.push({
          from: abs,
          to: t.target!,
          prefix: joinPath(local.prefix, use.prefix ?? ""),
          middleware: [...local.middleware, ...fileLevel(info, use.receiver, use.pos), ...names],
        });
      }
      if (!use.args.some((a) => isMount(a, abs)) && use.prefix !== undefined && names.length > 0) {
        scoped.push({ from: abs, prefix: joinPath(local.prefix, use.prefix), names });
      }
      if (use.kind === "app" && use.prefix === undefined) model.appMiddleware.push(...names);
    }
    if (info.entryLine !== undefined && !model.entry) model.entry = { file: info.file.path, line: info.entryLine };
  }

  const contextsOf = (abs: string, seen: Set<string>): MountContext[] => {
    const incoming = mounts.filter((m) => m.to === abs && !seen.has(m.from));
    if (incoming.length === 0) return [{ prefix: "", middleware: [] }];
    const next = new Set(seen).add(abs);
    return incoming
      .flatMap((m) =>
        contextsOf(m.from, next).map((c) => ({
          prefix: joinPath(c.prefix, m.prefix),
          middleware: [...c.middleware, ...m.middleware],
        })),
      )
      .slice(0, MAX_CONTEXTS);
  };

  for (const info of infos.values()) {
    if (info.routes.length === 0) continue;
    for (const ctx of contextsOf(info.file.abs, new Set())) {
      for (const r of info.routes) {
        const local = localContext(info, r.receiver);
        const full = joinPath(joinPath(ctx.prefix, local.prefix), r.path);
        const middleware = [...ctx.middleware, ...local.middleware, ...fileLevel(info, r.receiver, r.pos), ...r.middleware];
        for (const s of scoped) {
          for (const sctx of contextsOf(s.from, new Set())) {
            const scope = joinPath(sctx.prefix, s.prefix);
            if (scope === "/" || full === scope || full.startsWith(`${scope}/`)) middleware.push(...s.names);
          }
        }
        model.routes.push({
          method: r.method,
          path: full,
          file: info.file.path,
          line: r.line,
          params: [...full.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]!),
          middleware: [...new Set(middleware)],
          handler: r.handler,
          handlerRef: r.handlerRef,
        });
      }
    }
  }

  model.appMiddleware = [...new Set(model.appMiddleware)];
  model.routes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.path.localeCompare(b.path));
  return model;
}
