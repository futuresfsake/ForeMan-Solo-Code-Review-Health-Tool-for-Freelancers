import fs from "node:fs";
import path from "node:path";
import type { Severity } from "./types.js";

export class ConfigError extends Error {}

export interface IgnoreEntry {
  ruleId: string;
  file?: string;
  reason: string;
}

export interface Config {
  ignorePaths: string[];
  failUnder: number;
  audit: { enabled: boolean };
  sensitiveRoutes: { pathPatterns: string[]; methods: string[]; publicPaths: string[] };
  authMiddlewareNames: string[];
  weights: Record<Severity, number>;
  confidenceFactor: { high: number; medium: number; low: number };
  rules: Record<string, "off" | Severity>;
  ignore: IgnoreEntry[];
  checklist: { attest: Record<string, string> };
  report: { outDir: string; projectName: string; preparedBy: string; clientName: string };
}

export const CONFIG_FILE = "foreman.config.json";

export const DEFAULT_CONFIG: Config = {
  ignorePaths: ["node_modules", "dist", "build", "coverage", "*.test.*", "*.spec.*", "__tests__", "__mocks__", "test", "tests", "e2e", "cypress", "fixtures", "*.min.js"],
  failUnder: 0,
  audit: { enabled: true },
  sensitiveRoutes: {
    pathPatterns: ["/admin", "/internal", "/users", "/account", "/payments", "/billing"],
    methods: ["POST", "PUT", "PATCH", "DELETE"],
    publicPaths: ["/login", "/signin", "/register", "/signup", "/logout", "/auth", "/oauth", "/callback", "/refresh", "/verify", "/webhook", "/forgot", "/reset", "/health", "/contact", "/subscribe"],
  },
  authMiddlewareNames: [],
  weights: { blocker: 15, "should-fix": 5, "nice-to-have": 1 },
  confidenceFactor: { high: 1, medium: 0.6, low: 0.3 },
  rules: {},
  ignore: [],
  checklist: { attest: {} },
  report: { outDir: "./foreman-report", projectName: "", preparedBy: "", clientName: "" },
};

const SEVERITIES = new Set(["blocker", "should-fix", "nice-to-have"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ConfigError(`"${key}" must be an array of strings.`);
  }
  return value as string[];
}

/** Merges a user config object over the defaults, validating as it goes. */
export function mergeConfig(raw: unknown): Config {
  if (!isObject(raw)) throw new ConfigError("Config must be a JSON object.");
  const cfg: Config = structuredClone(DEFAULT_CONFIG);
  const known = new Set(Object.keys(DEFAULT_CONFIG).concat("framework", "$schema"));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new ConfigError(`Unknown config key "${key}".`);
  }

  if (raw.ignorePaths !== undefined) {
    cfg.ignorePaths = [...DEFAULT_CONFIG.ignorePaths, ...stringArray(raw.ignorePaths, "ignorePaths")];
  }
  if (raw.failUnder !== undefined) {
    if (typeof raw.failUnder !== "number" || raw.failUnder < 0 || raw.failUnder > 100) {
      throw new ConfigError(`"failUnder" must be a number from 0 to 100.`);
    }
    cfg.failUnder = raw.failUnder;
  }
  if (isObject(raw.audit) && typeof raw.audit.enabled === "boolean") cfg.audit.enabled = raw.audit.enabled;
  if (isObject(raw.sensitiveRoutes)) {
    const s = raw.sensitiveRoutes;
    if (s.pathPatterns !== undefined) cfg.sensitiveRoutes.pathPatterns = stringArray(s.pathPatterns, "sensitiveRoutes.pathPatterns");
    if (s.methods !== undefined) cfg.sensitiveRoutes.methods = stringArray(s.methods, "sensitiveRoutes.methods").map((m) => m.toUpperCase());
    if (s.publicPaths !== undefined) cfg.sensitiveRoutes.publicPaths = stringArray(s.publicPaths, "sensitiveRoutes.publicPaths");
  }
  if (raw.authMiddlewareNames !== undefined) cfg.authMiddlewareNames = stringArray(raw.authMiddlewareNames, "authMiddlewareNames");
  for (const key of ["weights", "confidenceFactor"] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!isObject(value)) throw new ConfigError(`"${key}" must be an object.`);
    for (const [k, v] of Object.entries(value)) {
      if (!(k in cfg[key]) || typeof v !== "number" || v < 0) {
        throw new ConfigError(`"${key}.${k}" is not a valid entry.`);
      }
      (cfg[key] as Record<string, number>)[k] = v;
    }
  }
  if (raw.rules !== undefined) {
    if (!isObject(raw.rules)) throw new ConfigError(`"rules" must be an object.`);
    for (const [id, v] of Object.entries(raw.rules)) {
      if (v !== "off" && !(typeof v === "string" && SEVERITIES.has(v))) {
        throw new ConfigError(`"rules.${id}" must be "off" or a severity.`);
      }
      cfg.rules[id] = v as "off" | Severity;
    }
  }
  if (raw.ignore !== undefined) {
    if (!Array.isArray(raw.ignore)) throw new ConfigError(`"ignore" must be an array.`);
    for (const entry of raw.ignore) {
      if (!isObject(entry) || typeof entry.ruleId !== "string") {
        throw new ConfigError(`Each "ignore" entry needs a "ruleId".`);
      }
      if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
        throw new ConfigError(`The "ignore" entry for ${entry.ruleId} needs a non-empty "reason".`);
      }
      cfg.ignore.push({
        ruleId: entry.ruleId,
        file: typeof entry.file === "string" ? entry.file : undefined,
        reason: entry.reason.trim(),
      });
    }
  }
  if (isObject(raw.checklist) && isObject(raw.checklist.attest)) {
    for (const [id, note] of Object.entries(raw.checklist.attest)) {
      if (typeof note !== "string" || note.trim() === "") {
        throw new ConfigError(`"checklist.attest.${id}" must be a non-empty note.`);
      }
      cfg.checklist.attest[id] = note.trim();
    }
  }
  if (isObject(raw.report)) {
    if (typeof raw.report.outDir === "string") cfg.report.outDir = raw.report.outDir;
    if (typeof raw.report.projectName === "string") cfg.report.projectName = raw.report.projectName;
    if (typeof raw.report.preparedBy === "string") cfg.report.preparedBy = raw.report.preparedBy;
    if (typeof raw.report.clientName === "string") cfg.report.clientName = raw.report.clientName;
  }
  return cfg;
}

/**
 * Loads the config for a project. An explicit path must exist; the default
 * file is optional.
 */
export function loadConfig(projectRoot: string, explicitPath?: string): Config {
  const file = explicitPath ? path.resolve(explicitPath) : path.join(projectRoot, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    if (explicitPath) throw new ConfigError(`Config file not found: ${explicitPath}`);
    return structuredClone(DEFAULT_CONFIG);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`Could not parse ${path.basename(file)}: ${(err as Error).message}`);
  }
  return mergeConfig(raw);
}
