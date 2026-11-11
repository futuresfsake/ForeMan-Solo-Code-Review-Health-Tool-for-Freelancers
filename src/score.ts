import type { Config } from "./config.js";
import type { ChecklistItem, Finding } from "./types.js";

/** At most this many findings per rule count toward the score. */
const PER_RULE_CAP = 3;

/**
 * 100 minus a weighted penalty per unsuppressed finding. The per-rule cap
 * stops one repeated issue from zeroing the score on its own.
 */
export function computeScore(findings: Finding[], config: Config): number {
  const perRule = new Map<string, number[]>();
  for (const f of findings) {
    if (f.suppressed) continue;
    const penalty = config.weights[f.severity] * config.confidenceFactor[f.confidence];
    perRule.set(f.ruleId, [...(perRule.get(f.ruleId) ?? []), penalty]);
  }
  let total = 0;
  for (const penalties of perRule.values()) {
    penalties.sort((a, b) => b - a);
    for (const p of penalties.slice(0, PER_RULE_CAP)) total += p;
  }
  return Math.max(0, Math.min(100, Math.round(100 - total)));
}

interface ChecklistDef {
  id: string;
  title: string;
  /** Rule ID prefixes whose unsuppressed findings fail this item. */
  rules: string[];
  /** The item can only be checked when routes were found. */
  needsRoutes?: boolean;
}

/** Checklist IDs are a public contract, like rule IDs. */
export const CHECKLIST: ChecklistDef[] = [
  { id: "GL-01", title: "Secrets removed from repo", rules: ["secrets/", "config/default-credentials"] },
  { id: "GL-02", title: "Debug/dev mode off", rules: ["config/debug-enabled"] },
  { id: "GL-03", title: "HTTPS enforced", rules: ["config/no-https-redirect"], needsRoutes: true },
  { id: "GL-04", title: "Backups configured", rules: [] },
  { id: "GL-05", title: "Error pages don't leak stack traces", rules: ["config/stack-trace-leak"] },
  { id: "GL-06", title: "Admin/internal routes locked down", rules: ["auth/missing-on-sensitive-route"], needsRoutes: true },
  { id: "GL-07", title: "Rate limiting on auth routes", rules: ["config/no-rate-limit-auth"], needsRoutes: true },
];

export function checklistItemsFor(ruleId: string): string[] {
  return CHECKLIST.filter((c) => c.rules.some((r) => ruleId.startsWith(r))).map((c) => c.id);
}

export function evaluateChecklist(findings: Finding[], config: Config, ranRules: Set<string>, hasRoutes: boolean): ChecklistItem[] {
  return CHECKLIST.map((def) => {
    const attested = config.checklist.attest[def.id];
    const failing = findings.filter((f) => !f.suppressed && f.checklistItems.includes(def.id));
    if (failing.length > 0) {
      return { id: def.id, title: def.title, status: "fail", note: `${failing.length} open finding(s)` };
    }
    let reason: string | undefined;
    if (def.rules.length === 0) reason = "cannot be checked from code";
    else if (def.needsRoutes && !hasRoutes) reason = "no routes were found to check";
    else if (!def.rules.some((r) => [...ranRules].some((id) => id.startsWith(r)))) reason = "the rule for this item did not run";
    if (reason) {
      return attested
        ? { id: def.id, title: def.title, status: "pass", note: `attested: ${attested}` }
        : { id: def.id, title: def.title, status: "unverified", note: `${reason}; attest it in the config if it is done` };
    }
    return { id: def.id, title: def.title, status: "pass" };
  });
}
