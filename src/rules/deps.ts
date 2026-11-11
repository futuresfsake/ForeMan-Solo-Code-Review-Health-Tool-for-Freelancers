import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AuditOutcome, AuditVulnerability, RawFinding, Rule, Severity } from "../types.js";

const NPM_LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"];
const OTHER_LOCKFILES = ["yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock"];

/** Turns `npm audit --json` output into a flat list. Exported for tests. */
export function parseAuditJson(stdout: string): AuditOutcome {
  let data: unknown;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "npm audit did not return JSON" };
  }
  const root = data as { error?: { summary?: string; code?: string }; vulnerabilities?: Record<string, unknown> };
  if (root.error) return { ok: false, reason: `npm audit failed (${root.error.code ?? root.error.summary ?? "unknown error"})` };
  const vulnerabilities: AuditVulnerability[] = [];
  for (const [name, raw] of Object.entries(root.vulnerabilities ?? {})) {
    const v = raw as { severity?: string; range?: string; via?: unknown[]; fixAvailable?: unknown };
    const advisory = (v.via ?? []).find((x): x is { title: string } => typeof x === "object" && x !== null && "title" in x);
    vulnerabilities.push({
      name,
      severity: v.severity ?? "unknown",
      range: v.range,
      title: advisory?.title,
      fixAvailable: Boolean(v.fixAvailable),
    });
  }
  vulnerabilities.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, vulnerabilities };
}

/**
 * Runs `npm audit` in the project. This is the only network call in a scan:
 * npm sends the dependency names and versions from the lockfile to the
 * registry. It installs nothing and runs no project scripts.
 */
export function runNpmAudit(root: string): AuditOutcome {
  const res = spawnSync("npm", ["audit", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) return { ok: false, reason: `npm audit could not run (${res.error.message})` };
  if (!res.stdout) return { ok: false, reason: "npm audit returned no output (offline?)" };
  return parseAuditJson(res.stdout);
}

function severityFor(level: string): Severity {
  if (level === "critical" || level === "high") return "blocker";
  if (level === "moderate") return "should-fix";
  return "nice-to-have";
}

export const depsRule: Rule = {
  ids: ["deps/vulnerable", "deps/no-lockfile"],
  run(model, ctx) {
    const findings: RawFinding[] = [];
    if (!model.packageJson) {
      ctx.skip("deps/vulnerable", "no package.json found");
      ctx.skip("deps/no-lockfile", "no package.json found");
      return findings;
    }
    const exists = (name: string): boolean => fs.existsSync(path.join(model.root, name));
    const hasNpmLock = NPM_LOCKFILES.some(exists);
    const hasOtherLock = OTHER_LOCKFILES.some(exists);
    const hasDeps = Object.keys({ ...(model.packageJson.dependencies as object | undefined) }).length > 0;

    if (!hasNpmLock && !hasOtherLock && hasDeps) {
      findings.push({ ruleId: "deps/no-lockfile", file: "package.json", line: 1, message: "The project has dependencies but no lockfile." });
    }

    if (!ctx.audit) {
      ctx.skip("deps/vulnerable", "dependency audit disabled for this run");
    } else if (!hasNpmLock) {
      ctx.skip("deps/vulnerable", hasOtherLock ? "only npm lockfiles are audited (yarn/pnpm/bun not supported yet)" : "no lockfile to audit");
    } else {
      const outcome = ctx.audit(model.root);
      if (!outcome.ok) {
        ctx.skip("deps/vulnerable", outcome.reason);
      } else {
        for (const v of outcome.vulnerabilities) {
          findings.push({
            ruleId: "deps/vulnerable",
            file: "package.json",
            line: 1,
            severity: severityFor(v.severity),
            message: `${v.name}${v.range ? ` (${v.range})` : ""}: ${v.severity} severity${v.title ? `, ${v.title}` : ""}.${v.fixAvailable ? " A fix is available." : ""}`,
          });
        }
      }
    }
    return findings;
  },
};
