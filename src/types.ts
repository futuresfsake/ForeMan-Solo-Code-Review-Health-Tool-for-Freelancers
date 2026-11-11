import type ts from "typescript";
import type { Config } from "./config.js";

export type Severity = "blocker" | "should-fix" | "nice-to-have";
export type Confidence = "high" | "medium" | "low";
export type ChecklistStatus = "pass" | "fail" | "unverified";
export type Trend = "up" | "flat" | "down" | "none";
export type Category = "secrets" | "injection" | "validation" | "auth" | "config" | "deps";

export interface Finding {
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
  /** Project-relative path with forward slashes. */
  file: string;
  line: number;
  message: string;
  /** The business consequence in plain English. */
  risk: string;
  remediation: string;
  checklistItems: string[];
  suppressed?: { reason: string };
}

export interface ParsedFile {
  /** Project-relative path with forward slashes. */
  path: string;
  abs: string;
  text: string;
  ast: ts.SourceFile;
}

export interface TextFile {
  path: string;
  abs: string;
  text: string;
}

export interface RouteInfo {
  method: string;
  path: string;
  file: string;
  line: number;
  params: string[];
  /** Middleware names in order: mount-level, router-level, then route-level. */
  middleware: string[];
  /** Inline or locally resolved handler function, when it could be found. */
  handler?: ts.Node;
  handlerRef: string;
}

export interface ProjectModel {
  root: string;
  name: string;
  framework: "express" | "unknown";
  routes: RouteInfo[];
  appMiddleware: string[];
  /** Where the Express app is created, used to anchor app-wide findings. */
  entry?: { file: string; line: number };
  files: ParsedFile[];
  textFiles: TextFile[];
  packageJson: Record<string, unknown> | null;
  config: Config;
}

export interface AuditVulnerability {
  name: string;
  severity: string;
  range?: string;
  title?: string;
  fixAvailable: boolean;
}

export type AuditOutcome =
  | { ok: true; vulnerabilities: AuditVulnerability[] }
  | { ok: false; reason: string };

export type AuditRunner = (root: string) => AuditOutcome;

export interface RuleContext {
  config: Config;
  /** Undefined when the dependency audit is disabled for this run. */
  audit?: AuditRunner;
  /** Rules call this when they cannot run, so the report can say so. */
  skip(ruleId: string, reason: string): void;
}

export interface Rule {
  /** Every rule ID this module can emit. */
  ids: string[];
  /** Rules that need framework routes are skipped when no adapter matched. */
  needsRoutes?: boolean;
  run(model: ProjectModel, ctx: RuleContext): RawFinding[];
}

/** What a rule returns; the aggregator fills in the rest from the catalog. */
export interface RawFinding {
  ruleId: string;
  file: string;
  line: number;
  message: string;
  confidence?: Confidence;
  severity?: Severity;
}

export interface ChecklistItem {
  id: string;
  title: string;
  status: ChecklistStatus;
  note?: string;
}

export interface ScanResult {
  schemaVersion: 1;
  tool: "foreman-solo";
  toolVersion: string;
  scannedAt: string;
  project: { name: string; framework: "express" | "unknown" };
  score: number;
  trend: Trend;
  previousScan?: { scannedAt: string; score: number };
  readyToShip: boolean;
  checklist: ChecklistItem[];
  findings: Finding[];
  coverage: {
    filesScanned: number;
    filesWithSyntaxErrors: number;
    routesFound: number;
    rulesRun: string[];
    rulesSkipped: { id: string; reason: string }[];
  };
  warnings: string[];
}
