import ts from "typescript";
import { lineOf, stringValue, unwrap, walk } from "../ast.js";
import type { RawFinding, Rule } from "../types.js";
import { DEFAULT_CREDENTIALS, NOT_A_SECRET_NAME, SECRET_NAME, isUiLabel, stringAssignments } from "./shared.js";

const HTTPS_EVIDENCE = /helmet|hsts|strict-transport-security|x-forwarded-proto|\.secure\b|express-sslify|enforce.{0,12}ssl|https\.createServer|force.{0,6}https/i;
const DEFAULT_URL_CREDENTIALS = /:\/\/([A-Za-z0-9_]+):(password|admin|root|secret|changeme|123456|postgres|mysql|test)@/i;
const RESPONSE_METHODS = new Set(["send", "json", "end", "render", "write", "jsonp"]);

/** True when a call chain such as `res.status(500).json(...)` starts at `res`. */
function startsAtResponse(expr: ts.Expression): boolean {
  let cur = expr;
  for (;;) {
    if (ts.isIdentifier(cur)) return /^(res|response)$/.test(cur.text);
    if (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    else if (ts.isCallExpression(cur)) cur = cur.expression;
    else return false;
  }
}

function mentionsStack(node: ts.Node): boolean {
  let found = false;
  walk(node, (n) => {
    if (ts.isPropertyAccessExpression(n) && n.name.text === "stack") found = true;
  });
  return found;
}

function property(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) {
      return p.initializer;
    }
  }
  return undefined;
}

export const configRule: Rule = {
  ids: ["config/debug-enabled", "config/permissive-cors", "config/default-credentials", "config/stack-trace-leak"],
  run(model) {
    const findings: RawFinding[] = [];

    const scripts = (model.packageJson?.scripts ?? {}) as Record<string, unknown>;
    const start = typeof scripts.start === "string" ? scripts.start : "";
    if (/NODE_ENV=(development|dev)\b/.test(start)) {
      findings.push({ ruleId: "config/debug-enabled", file: "package.json", line: 1, message: `The "start" script sets NODE_ENV to development.` });
    } else if (/\b(nodemon|ts-node-dev|tsx watch|node --watch)\b/.test(start)) {
      findings.push({ ruleId: "config/debug-enabled", file: "package.json", line: 1, message: `The "start" script runs a development watcher (${start.split(" ")[0]}).` });
    }

    for (const file of model.files) {
      const sf = file.ast;
      let openCorsReported = false;

      for (const a of stringAssignments(sf)) {
        const line = lineOf(sf, a.node);
        if (SECRET_NAME.test(a.name) && !NOT_A_SECRET_NAME.test(a.name) && DEFAULT_CREDENTIALS.has(a.value.toLowerCase())) {
          if (!a.envFallback && isUiLabel(a.name, a.value, file.path)) continue;
          findings.push({
            ruleId: "config/default-credentials",
            file: file.path,
            line,
            message: a.envFallback
              ? `"${a.name}" falls back to the default value "${a.value}" when the environment variable is missing.`
              : `"${a.name}" is set to the default value "${a.value}".`,
          });
        } else if (DEFAULT_URL_CREDENTIALS.test(a.value)) {
          findings.push({ ruleId: "config/default-credentials", file: file.path, line, message: `"${a.name}" contains a connection string with default credentials.` });
        }
      }

      walk(sf, (n) => {
        if (!ts.isCallExpression(n)) return;
        const callee = n.expression;

        if (ts.isIdentifier(callee) && callee.text === "cors") {
          const arg = n.arguments[0] ? unwrap(n.arguments[0]) : undefined;
          if (!arg) {
            if (openCorsReported) return;
            openCorsReported = true;
            findings.push({ ruleId: "config/permissive-cors", file: file.path, line: lineOf(sf, n), message: "cors() is called with no options, which allows every origin." });
          } else if (ts.isObjectLiteralExpression(arg)) {
            const origin = property(arg, "origin");
            const open = origin && (stringValue(origin) === "*" || origin.kind === ts.SyntaxKind.TrueKeyword);
            const credentials = property(arg, "credentials")?.kind === ts.SyntaxKind.TrueKeyword;
            if (open) {
              findings.push({
                ruleId: "config/permissive-cors",
                file: file.path,
                line: lineOf(sf, n),
                confidence: "high",
                message: credentials
                  ? "CORS allows every origin and also sends credentials, so any website can make authenticated requests."
                  : "CORS allows every origin.",
              });
            }
          }
          return;
        }

        if (!ts.isPropertyAccessExpression(callee)) return;
        const method = callee.name.text;

        if ((method === "header" || method === "setHeader" || method === "set") && n.arguments.length >= 2) {
          if (stringValue(n.arguments[0])?.toLowerCase() === "access-control-allow-origin" && stringValue(n.arguments[1]) === "*") {
            findings.push({ ruleId: "config/permissive-cors", file: file.path, line: lineOf(sf, n), message: "Access-Control-Allow-Origin is set to * by hand." });
          }
        }

        if (method === "set" && stringValue(n.arguments[0]) === "env" && /^dev/.test(stringValue(n.arguments[1]) ?? "")) {
          findings.push({ ruleId: "config/debug-enabled", file: file.path, line: lineOf(sf, n), message: "The app environment is hardcoded to development." });
        }

        if (RESPONSE_METHODS.has(method) && startsAtResponse(callee.expression) && n.arguments.some(mentionsStack)) {
          findings.push({ ruleId: "config/stack-trace-leak", file: file.path, line: lineOf(sf, n), message: "An error stack trace is sent in the HTTP response." });
        }
      });
    }

    return findings;
  },
};

export const httpsRule: Rule = {
  ids: ["config/no-https-redirect"],
  needsRoutes: true,
  run(model) {
    const deps = Object.keys({ ...(model.packageJson?.dependencies as object | undefined) });
    // Commented-out code is not evidence.
    const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/.*$/gm, "$1");
    if (deps.some((d) => HTTPS_EVIDENCE.test(d)) || model.files.some((f) => HTTPS_EVIDENCE.test(code(f.text)))) return [];
    const anchor = model.entry ?? (model.routes[0] ? { file: model.routes[0].file, line: model.routes[0].line } : undefined);
    if (!anchor) return [];
    return [
      {
        ruleId: "config/no-https-redirect",
        file: anchor.file,
        line: anchor.line,
        message: "No HTTPS redirect or HSTS header was found in the code. This may be handled by your host or proxy.",
      },
    ];
  },
};
