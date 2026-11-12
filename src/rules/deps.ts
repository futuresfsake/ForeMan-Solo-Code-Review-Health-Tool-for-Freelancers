import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { UNSAFE_IN_SHELL, childEnv, findProgram, windowsShell } from "../exec.js";
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
 *
 * npm is started by absolute path and never from the project folder, so a
 * project that ships its own `npm.cmd` cannot have it run (see src/exec.ts).
 */
export function runNpmAudit(root: string): AuditOutcome {
  const npm = findProgram("npm", { avoid: root, extensions: [".exe", ".cmd"] });
  if (!npm) return { ok: false, reason: "npm was not found on this machine" };
  // On Windows npm is a .cmd script, which only the command interpreter can start.
  const script = /\.(cmd|bat)$/i.test(npm);
  if (script && UNSAFE_IN_SHELL.test(npm)) {
    return { ok: false, reason: "npm is installed in a folder whose name cannot be passed to the Windows shell safely" };
  }
  const common = { cwd: root, encoding: "utf8" as const, env: childEnv(), timeout: 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true };
  const res = script
    ? spawnSync(`"${npm}" audit --json`, { ...common, shell: windowsShell() })
    : spawnSync(npm, ["audit", "--json"], common);
  if (res.error) return { ok: false, reason: `npm audit could not run (${res.error.message})` };
  if (!res.stdout) return { ok: false, reason: "npm audit returned no output (offline?)" };
  return parseAuditJson(res.stdout);
}

/** Settings in a project's own `.npmrc` that change which server `npm audit` asks, or whether its answer can be trusted. */
const NPMRC_KEYS = /^\s*((?:@[^:=\s]+:)?registry|proxy|https-proxy|strict-ssl|cafile|ca|audit|audit-level)\s*=/i;

/**
 * `npm audit` obeys the project's `.npmrc`. A project you did not write can use
 * it to send the audit to its own server, which could answer "no problems".
 * The scan cannot stop npm reading the file, so it says when this applies.
 */
export function npmrcNotes(root: string): string[] {
  let text: string;
  try {
    const file = path.join(root, ".npmrc");
    if (fs.statSync(file).size > 64 * 1024) return ["This project's .npmrc is unusually large and was not read. Check it before relying on the dependency result."];
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = NPMRC_KEYS.exec(line.slice(0, 200));
    if (m) keys.add(m[1]!.toLowerCase().replace(/^@.*:registry$/, "a scoped registry"));
  }
  if (keys.size === 0) return [];
  return [`This project's .npmrc sets ${[...keys].sort().join(", ")}, which changes where or how the dependency check asks for advisories. Read .npmrc before relying on the dependency result.`];
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
