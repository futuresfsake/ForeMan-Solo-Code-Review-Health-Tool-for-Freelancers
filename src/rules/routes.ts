import ts from "typescript";
import { isFunctionLike } from "../ast.js";
import type { RawFinding, RouteInfo, Rule } from "../types.js";
import { hasAuth, hasRateLimit } from "./shared.js";

const VALIDATION_MIDDLEWARE = /valid|schema|celebrate|joi|zod|yup|sanitiz|^(body|param|query|check|checkSchema|oneOf|header|cookie)\b/i;
const VALIDATION_IN_HANDLER = /\.(parse|safeParse|parseAsync|validate|validateAsync|validateSync)\s*\(|validationResult\s*\(|matchedData\s*\(|\bJoi\.|\bz\.|\byup\.|\bajv\b|parseInt\s*\(|Number\s*\(|isNaN\s*\(|typeof\s|isUUID|isMongoId|isValid|ObjectId\.isValid/;
const AUTH_ROUTE = /login|signin|sign-in|register|signup|sign-up|password|reset|forgot|token|otp|verify/i;

function label(route: RouteInfo): string {
  return `${route.method} ${route.path}`;
}

function containsSegment(routePath: string, pattern: string): boolean {
  const p = pattern.toLowerCase().replace(/\/$/, "");
  const lower = routePath.toLowerCase();
  return lower === p || lower.startsWith(`${p}/`) || lower.includes(`${p}/`) || lower.endsWith(p);
}

export const authRule: Rule = {
  ids: ["auth/missing-on-sensitive-route"],
  needsRoutes: true,
  run(model) {
    const findings: RawFinding[] = [];
    const { pathPatterns, methods, publicPaths } = model.config.sensitiveRoutes;
    for (const route of model.routes) {
      if (hasAuth(route, model)) continue;
      const byPath = pathPatterns.find((p) => containsSegment(route.path, p));
      const isPublic = publicPaths.some((p) => containsSegment(route.path, p));
      if (byPath && !isPublic) {
        findings.push({
          ruleId: "auth/missing-on-sensitive-route",
          file: route.file,
          line: route.line,
          message: `${label(route)} is under "${byPath}" and has no authentication middleware.`,
        });
      } else if (!byPath && !isPublic && methods.includes(route.method)) {
        findings.push({
          ruleId: "auth/missing-on-sensitive-route",
          file: route.file,
          line: route.line,
          severity: "should-fix",
          confidence: "low",
          message: `${label(route)} changes data and has no authentication middleware.`,
        });
      }
    }
    return findings;
  },
};

export const validationRule: Rule = {
  ids: ["validation/unvalidated-param"],
  needsRoutes: true,
  run(model) {
    const findings: RawFinding[] = [];
    for (const route of model.routes) {
      const handler = route.handler;
      if (!handler || !isFunctionLike(handler)) continue;
      const first = handler.parameters[0];
      if (!first || !ts.isIdentifier(first.name)) continue;
      const req = first.name.text;
      const text = handler.getText();
      const used = new RegExp(`\\b${req}\\.(params|body|query)\\b`).exec(text);
      if (!used) continue;
      const names = [...model.appMiddleware, ...route.middleware];
      if (names.some((n) => VALIDATION_MIDDLEWARE.test(n))) continue;
      if (VALIDATION_IN_HANDLER.test(text)) continue;
      findings.push({
        ruleId: "validation/unvalidated-param",
        file: route.file,
        line: route.line,
        message: `${label(route)} reads ${req}.${used[1]} with no visible validation.`,
      });
    }
    return findings;
  },
};

export const rateLimitRule: Rule = {
  ids: ["config/no-rate-limit-auth"],
  needsRoutes: true,
  run(model) {
    const findings: RawFinding[] = [];
    for (const route of model.routes) {
      if (route.method !== "POST" && route.method !== "ALL") continue;
      if (!AUTH_ROUTE.test(route.path) || hasRateLimit(route, model)) continue;
      findings.push({
        ruleId: "config/no-rate-limit-auth",
        file: route.file,
        line: route.line,
        message: `${label(route)} looks like an authentication route and has no rate limiting.`,
      });
    }
    return findings;
  },
};
