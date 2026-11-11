import ts from "typescript";
import { stringValue, walk } from "../ast.js";
import type { Config } from "../config.js";
import type { ProjectModel, RouteInfo } from "../types.js";

const AUTH_NAME = /auth|jwt|passport|protect|guard|verifytoken|isadmin|requirelogin|ensurelogged|requireuser|requirerole|permission|loggedin|acl/i;
const NOT_AUTH = /limit|throttle|slowdown|initialize|session$|authrout|optional/i;
const RATE_LIMIT_NAME = /limit|throttle|brute|slowdown/i;

export function isAuthName(name: string, config: Config): boolean {
  if (NOT_AUTH.test(name)) return false;
  const lower = name.toLowerCase();
  return AUTH_NAME.test(name) || config.authMiddlewareNames.some((n) => lower.includes(n.toLowerCase()));
}

export function hasAuth(route: RouteInfo, model: ProjectModel): boolean {
  return [...model.appMiddleware, ...route.middleware].some((n) => isAuthName(n, model.config));
}

export function hasRateLimit(route: RouteInfo, model: ProjectModel): boolean {
  return [...model.appMiddleware, ...route.middleware].some((n) => RATE_LIMIT_NAME.test(n));
}

/** Shows enough of a secret to find it, never enough to use it. */
export function redact(secret: string): string {
  return `${secret.slice(0, 4)}… (${secret.length} characters)`;
}

export interface Assignment {
  name: string;
  value: string;
  node: ts.Node;
  /** True for `process.env.X || 'literal'`: the literal is a fallback. */
  envFallback: boolean;
}

function propertyName(name: ts.PropertyName | ts.BindingName | ts.Expression): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.name.text;
  return undefined;
}

/** Every place a plain string literal is given a name. */
export function stringAssignments(sf: ts.SourceFile): Assignment[] {
  const out: Assignment[] = [];
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const value = stringValue(n.initializer);
      const name = propertyName(n.name);
      if (value !== undefined && name) out.push({ name, value, node: n, envFallback: false });
    } else if (ts.isPropertyAssignment(n)) {
      const value = stringValue(n.initializer);
      const name = propertyName(n.name);
      if (value !== undefined && name) out.push({ name, value, node: n, envFallback: false });
    } else if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      const value = stringValue(n.right);
      if (value === undefined) return;
      if (op === ts.SyntaxKind.EqualsToken) {
        const name = propertyName(n.left);
        if (name) out.push({ name, value, node: n, envFallback: false });
      } else if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        const left = n.left.getText(sf);
        const env = /process\.env\.([A-Za-z0-9_]+)$|process\.env\[['"]([A-Za-z0-9_]+)['"]\]$/.exec(left);
        if (env) out.push({ name: env[1] ?? env[2]!, value, node: n, envFallback: true });
      }
    }
  });
  return out;
}

export const SECRET_NAME = /pass(word|wd)?|pwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?key/i;
/** Names that mention a secret but hold something else (a URL, a header name, a TTL). */
export const NOT_A_SECRET_NAME = /(url|uri|path|field|name|type|header|prefix|expiry|expires|expiresin|length|regex|pattern|label|message|placeholder|param|endpoint|min|max|id|ttl|algorithm|strategy|cookie)$/i;

export const DEFAULT_CREDENTIALS = new Set([
  "password", "passw0rd", "password1", "password123", "admin", "admin123", "administrator", "changeme", "change_me",
  "123456", "12345678", "secret", "root", "toor", "test", "default", "letmein", "qwerty", "guest", "postgres", "mysql",
]);
