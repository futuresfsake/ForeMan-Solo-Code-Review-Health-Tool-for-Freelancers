import ts from "typescript";
import { lineOf, unwrap, walk } from "../ast.js";
import type { RawFinding, Rule } from "../types.js";

const SINKS = new Set(["query", "execute", "raw", "queryRaw", "executeRaw", "$queryRawUnsafe", "$executeRawUnsafe", "all", "get", "run", "each", "prepare"]);
const SQL = /\b(select\s[\s\S]+\sfrom|insert\s+into|update\s+\S+\s+set|delete\s+from)\b/i;
const USER_INPUT = /\breq\b|\brequest\b|\bparams\b|\bbody\b|\bquery\b|\binput\b|\bargs\b|\bctx\b/;

interface Parts {
  staticText: string;
  dynamic: string[];
}

function collect(expr: ts.Expression, sf: ts.SourceFile, parts: Parts, depth: number): void {
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    parts.staticText += e.text;
  } else if (ts.isTemplateExpression(e)) {
    parts.staticText += e.head.text;
    for (const span of e.templateSpans) {
      parts.dynamic.push(span.expression.getText(sf));
      parts.staticText += ` ? ${span.literal.text}`;
    }
  } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    collect(e.left, sf, parts, depth);
    collect(e.right, sf, parts, depth);
  } else if (ts.isIdentifier(e) && depth < 2) {
    // Follow `const sql = "..." + x; db.query(sql)` within the same file.
    const decl = findDeclaration(sf, e.text, e.getStart(sf));
    if (decl?.initializer) collect(decl.initializer, sf, parts, depth + 1);
    else parts.dynamic.push(e.text);
  } else if (!ts.isNumericLiteral(e)) {
    parts.dynamic.push(e.getText(sf));
  }
}

function findDeclaration(sf: ts.SourceFile, name: string, before: number): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  walk(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.getStart(sf) < before) found = n;
  });
  return found;
}

export const injectionRule: Rule = {
  ids: ["injection/sql-concat"],
  run(model) {
    const findings: RawFinding[] = [];
    for (const file of model.files) {
      const sf = file.ast;
      walk(sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
        if (!SINKS.has(n.expression.name.text) || n.arguments.length === 0) return;
        const first = unwrap(n.arguments[0]!);
        // A bare string is safe, and a bare identifier is only interesting
        // when it resolves to a concatenation.
        if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) return;
        const parts: Parts = { staticText: "", dynamic: [] };
        collect(first, sf, parts, 0);
        if (parts.dynamic.length === 0 || !SQL.test(parts.staticText)) return;
        const tainted = parts.dynamic.some((d) => USER_INPUT.test(d));
        findings.push({
          ruleId: "injection/sql-concat",
          file: file.path,
          line: lineOf(sf, n),
          confidence: tainted ? "high" : "medium",
          message: tainted
            ? `SQL query is built by inserting request data (${parts.dynamic[0]}) directly into the string.`
            : `SQL query is built by inserting a variable (${parts.dynamic[0]}) directly into the string.`,
        });
      });
    }
    return findings;
  },
};
