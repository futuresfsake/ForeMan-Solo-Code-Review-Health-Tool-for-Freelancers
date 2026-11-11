import type { Category, Confidence, Severity } from "../types.js";

export interface RuleMeta {
  category: Category;
  severity: Severity;
  confidence: Confidence;
  title: string;
  remediation: string;
}

/**
 * The single source of truth for rule IDs. IDs are a public contract: never
 * rename one without a deprecation (see docs/release-process.md).
 */
export const CATALOG: Record<string, RuleMeta> = {
  "secrets/hardcoded-api-key": {
    category: "secrets",
    severity: "blocker",
    confidence: "high",
    title: "Hardcoded API key or private key",
    remediation: "Revoke and rotate this credential now, then load it from an environment variable or a secret manager. Removing it from the file does not remove it from git history.",
  },
  "secrets/hardcoded-password": {
    category: "secrets",
    severity: "blocker",
    confidence: "medium",
    title: "Hardcoded password, secret or token",
    remediation: "Move the value to an environment variable and rotate it if it was ever real.",
  },
  "secrets/committed-env": {
    category: "secrets",
    severity: "blocker",
    confidence: "high",
    title: "Environment file in the repository",
    remediation: "Add the file to .gitignore, remove it from git (git rm --cached), and rotate every secret it contained.",
  },
  "injection/sql-concat": {
    category: "injection",
    severity: "blocker",
    confidence: "medium",
    title: "SQL built from dynamic strings",
    remediation: "Use parameterized queries (placeholders with a values array) or your query builder's bindings instead of concatenating values into SQL.",
  },
  "validation/unvalidated-param": {
    category: "validation",
    severity: "should-fix",
    confidence: "medium",
    title: "Request input used without validation",
    remediation: "Validate and coerce request input with a schema (zod, joi, express-validator) before using it.",
  },
  "auth/missing-on-sensitive-route": {
    category: "auth",
    severity: "blocker",
    confidence: "medium",
    title: "Sensitive route without authentication",
    remediation: "Add authentication middleware to this route or its router. If the route is public on purpose, suppress this finding with a reason.",
  },
  "config/debug-enabled": {
    category: "config",
    severity: "should-fix",
    confidence: "high",
    title: "Debug or development mode enabled",
    remediation: "Run production with NODE_ENV=production and a plain node start command.",
  },
  "config/no-https-redirect": {
    category: "config",
    severity: "should-fix",
    confidence: "low",
    title: "No HTTPS enforcement found in code",
    remediation: "Enforce HTTPS (helmet's HSTS plus a redirect). If your host or proxy already does this, suppress this finding with a note saying where.",
  },
  "config/permissive-cors": {
    category: "config",
    severity: "should-fix",
    confidence: "medium",
    title: "CORS allows any origin",
    remediation: "Set an explicit list of allowed origins.",
  },
  "config/default-credentials": {
    category: "config",
    severity: "blocker",
    confidence: "high",
    title: "Default or example credentials",
    remediation: "Remove the default value and fail at startup when the real credential is missing.",
  },
  "config/stack-trace-leak": {
    category: "config",
    severity: "should-fix",
    confidence: "high",
    title: "Stack trace sent to the client",
    remediation: "Log the stack on the server and send the client a generic error message.",
  },
  "config/no-rate-limit-auth": {
    category: "config",
    severity: "should-fix",
    confidence: "medium",
    title: "Authentication route without rate limiting",
    remediation: "Add a rate limiter (for example express-rate-limit) to login, registration and password-reset routes.",
  },
  "deps/vulnerable": {
    category: "deps",
    severity: "should-fix",
    confidence: "high",
    title: "Dependency with a known vulnerability",
    remediation: "Update the package (npm audit fix, or a manual upgrade if the fix is a breaking change).",
  },
  "deps/no-lockfile": {
    category: "deps",
    severity: "nice-to-have",
    confidence: "high",
    title: "No lockfile",
    remediation: "Commit a lockfile so installs are reproducible and dependencies can be audited.",
  },
};
