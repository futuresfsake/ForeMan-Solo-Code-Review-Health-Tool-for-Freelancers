import type { Category, Confidence, Severity } from "../types.js";

export interface RuleMeta {
  category: Category;
  severity: Severity;
  confidence: Confidence;
  title: string;
  /** Plain-English name for non-technical readers. */
  plainTitle: string;
  /** The business consequence, in plain English. Says "could", never "will". */
  risk: string;
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
    plainTitle: "A service key is stored in the code",
    risk: "Anyone who can read the code, including past contractors and anyone who obtains a copy of the repository, could use this key to act as your business on that service. That can mean unexpected charges, leaked customer data and an emergency key rotation.",
    remediation: "Revoke and rotate this credential now, then load it from an environment variable or a secret manager. Removing it from the file does not remove it from git history.",
  },
  "secrets/hardcoded-password": {
    category: "secrets",
    severity: "blocker",
    confidence: "medium",
    title: "Hardcoded password, secret or token",
    plainTitle: "A password or secret is written into the code",
    risk: "A password in the code is shared with everyone who ever sees the code and cannot be changed without a new release. If it protects logins or data, a leak of the code becomes a leak of the system.",
    remediation: "Move the value to an environment variable and rotate it if it was ever real.",
  },
  "secrets/committed-env": {
    category: "secrets",
    severity: "blocker",
    confidence: "high",
    title: "Environment file in the repository",
    plainTitle: "The private settings file is stored with the code",
    risk: "The settings file usually holds database passwords and service keys. Stored with the code, every copy of the project carries them, and they stay in the history even after deletion.",
    remediation: "Add the file to .gitignore, remove it from git (git rm --cached), and rotate every secret it contained.",
  },
  "injection/sql-concat": {
    category: "injection",
    severity: "blocker",
    confidence: "medium",
    title: "SQL built from dynamic strings",
    plainTitle: "Database commands are assembled from user input",
    risk: "A visitor could type database commands into a form or web address and have them run. This is one of the most common ways customer records are stolen, changed or deleted.",
    remediation: "Use parameterized queries (placeholders with a values array) or your query builder's bindings instead of concatenating values into SQL.",
  },
  "injection/code-eval": {
    category: "injection",
    severity: "blocker",
    confidence: "medium",
    title: "Dynamic code execution",
    plainTitle: "The server runs text from users as program code",
    risk: "A visitor could send instructions that the server then executes, which could give them control of the server and everything it can reach.",
    remediation: "Never pass request data to eval or new Function. Parse the value instead (Number, JSON.parse) and validate it.",
  },
  "validation/unvalidated-param": {
    category: "validation",
    severity: "should-fix",
    confidence: "medium",
    title: "Request input used without validation",
    plainTitle: "Incoming data is not checked before use",
    risk: "Unexpected or malformed input could cause errors, corrupt records or open the door to other attacks. Unchecked input is the starting point for most application bugs that reach customers.",
    remediation: "Validate and coerce request input with a schema (zod, joi, express-validator) before using it.",
  },
  "auth/missing-on-sensitive-route": {
    category: "auth",
    severity: "blocker",
    confidence: "medium",
    title: "Sensitive route without authentication",
    plainTitle: "A sensitive page or action may not require login",
    risk: "If this action really is reachable without logging in, anyone who finds the address could view or change data meant for staff or account owners.",
    remediation: "Add authentication middleware to this route or its router. If the route is public on purpose, suppress this finding with a reason.",
  },
  "config/debug-enabled": {
    category: "config",
    severity: "should-fix",
    confidence: "high",
    title: "Debug or development mode enabled",
    plainTitle: "The app is set up to run in development mode",
    risk: "Development mode is slower and shows detailed internal error information to visitors, which helps an attacker understand the system.",
    remediation: "Run production with NODE_ENV=production and a plain node start command.",
  },
  "config/no-https-redirect": {
    category: "config",
    severity: "should-fix",
    confidence: "low",
    title: "No HTTPS enforcement found in code",
    plainTitle: "The code does not force a secure connection",
    risk: "Without an enforced secure connection, logins and personal data could be read on shared networks. Your hosting provider may already handle this; it should be confirmed.",
    remediation: "Enforce HTTPS (helmet's HSTS plus a redirect). If your host or proxy already does this, suppress this finding with a note saying where.",
  },
  "config/permissive-cors": {
    category: "config",
    severity: "should-fix",
    confidence: "medium",
    title: "CORS allows any origin",
    plainTitle: "Any website is allowed to call this service",
    risk: "Other websites could make requests to this service from a visitor's browser. Combined with login cookies, that could let a malicious site act as the visitor.",
    remediation: "Set an explicit list of allowed origins.",
  },
  "config/default-credentials": {
    category: "config",
    severity: "blocker",
    confidence: "high",
    title: "Default or example credentials",
    plainTitle: "A well-known default password is in use",
    risk: "Default passwords are the first thing automated attacks try. If this one reaches production, the system behind it should be considered open.",
    remediation: "Remove the default value and fail at startup when the real credential is missing.",
  },
  "config/stack-trace-leak": {
    category: "config",
    severity: "should-fix",
    confidence: "high",
    title: "Stack trace sent to the client",
    plainTitle: "Error pages reveal internal details",
    risk: "Detailed error output shows visitors file names, libraries and code paths, which makes other weaknesses easier to find and looks unprofessional to customers.",
    remediation: "Log the stack on the server and send the client a generic error message.",
  },
  "config/no-rate-limit-auth": {
    category: "config",
    severity: "should-fix",
    confidence: "medium",
    title: "Authentication route without rate limiting",
    plainTitle: "Login attempts are not limited",
    risk: "Without a limit, an attacker could try thousands of passwords per minute against customer accounts, and sign-up or reset forms could be abused to send spam.",
    remediation: "Add a rate limiter (for example express-rate-limit) to login, registration and password-reset routes.",
  },
  "deps/vulnerable": {
    category: "deps",
    severity: "should-fix",
    confidence: "high",
    title: "Dependency with a known vulnerability",
    plainTitle: "A third-party component has a published security flaw",
    risk: "Published flaws in common components are scanned for automatically across the internet. Whether this one can be exploited here depends on how the component is used, so it should be updated or reviewed.",
    remediation: "Update the package (npm audit fix, or a manual upgrade if the fix is a breaking change).",
  },
  "deps/no-lockfile": {
    category: "deps",
    severity: "nice-to-have",
    confidence: "high",
    title: "No lockfile",
    plainTitle: "Component versions are not pinned",
    risk: "Each install could pull slightly different component versions, so a problem may appear in production that never appeared in testing, and components cannot be reliably checked for known flaws.",
    remediation: "Commit a lockfile so installs are reproducible and dependencies can be audited.",
  },
};
