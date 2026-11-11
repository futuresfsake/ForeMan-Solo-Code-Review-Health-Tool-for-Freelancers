import { CATALOG } from "../rules/catalog.js";
import type { ScanResult } from "../types.js";
import type { Brand } from "./brand.js";
import { escapeHtml as e, page } from "./html.js";
import { open } from "./text.js";

export interface ClientReportOptions {
  preparedBy?: string;
  clientName?: string;
  brand?: Brand;
}

/** The accent is only used for borders, so any colour stays readable in light and dark mode. */
function brandCss(brand: Brand | undefined): string {
  let css = "";
  if (brand?.accentColor) {
    css += `.brand-header{border-top:5px solid ${brand.accentColor};padding-top:16px}h2{border-left:4px solid ${brand.accentColor};padding-left:10px}`;
  }
  if (brand?.logoDataUri) css += ".logo{display:block;max-height:56px;max-width:240px;margin-bottom:12px}";
  return css;
}

const PRIORITY = {
  blocker: { label: "Fix before launch", cls: "bad" },
  "should-fix": { label: "Should be fixed", cls: "warn" },
  "nice-to-have": { label: "Worth improving", cls: "muted" },
} as const;

const STATUS_WORDS = { pass: "Done", fail: "Needs work", unverified: "Not confirmed" } as const;
const STATUS_CLASS = { pass: "good", fail: "bad", unverified: "warn" } as const;

/**
 * A non-technical summary for a client: what was reviewed, what was found in
 * business terms, and what is still open. It contains no file paths, code or
 * secrets, and it never states that the project is secure.
 */
export function renderClientHtml(result: ScanResult, options: ClientReportOptions = {}): string {
  const findings = open(result);
  const groups = new Map<string, number>();
  for (const f of findings) groups.set(f.ruleId, (groups.get(f.ruleId) ?? 0) + 1);

  const order = { blocker: 0, "should-fix": 1, "nice-to-have": 2 } as const;
  const items = [...groups]
    .map(([ruleId, count]) => {
      const severity = findings.filter((f) => f.ruleId === ruleId).sort((a, b) => order[a.severity] - order[b.severity])[0]!.severity;
      return { ruleId, count, severity, meta: CATALOG[ruleId]! };
    })
    .sort((a, b) => order[a.severity] - order[b.severity] || a.meta.plainTitle.localeCompare(b.meta.plainTitle));

  const checked = result.coverage.rulesRun.length;
  const notChecked = result.coverage.rulesSkipped.length;
  const date = result.scannedAt.slice(0, 10);
  const lines = [
    options.clientName ? `Prepared for ${e(options.clientName)}` : "",
    options.preparedBy ? `Prepared by ${e(options.preparedBy)}` : "",
  ].filter(Boolean);

  const logo = options.brand?.logoDataUri
    ? `<img class="logo" src="${e(options.brand.logoDataUri)}" alt="${e(options.preparedBy ? `${options.preparedBy} logo` : "Logo")}">\n`
    : "";

  const body = `<div class="brand-header">
${logo}<h1>Code review summary: ${e(result.project.name)}</h1>
<div class="muted">Automated review completed on ${e(date)}${lines.length ? ` · ${lines.join(" · ")}` : ""}</div>
</div>

<div class="card summary">
<div><div><strong>${checked} automated check(s) were run on the project's code.</strong></div>
<div class="muted">${findings.length} item(s) need attention across ${items.length} topic(s).${notChecked ? ` ${notChecked} check(s) could not be run; see the note at the end.` : ""}</div></div>
</div>

<h2>What was found</h2>
<div class="card scroll">${
    items.length === 0
      ? "The automated checks that ran did not raise any items."
      : `<table><thead><tr><th>Priority</th><th>Topic and why it matters</th><th>Places</th></tr></thead><tbody>
${items
  .map(
    (i) => `<tr>
<td><span class="tag ${PRIORITY[i.severity].cls}">${PRIORITY[i.severity].label}</span></td>
<td><strong>${e(i.meta.plainTitle)}</strong><div class="fix">${e(i.meta.risk)}</div></td>
<td>${i.count}</td>
</tr>`,
  )
  .join("\n")}
</tbody></table>`
  }</div>

<h2>Launch checklist</h2>
<div class="card scroll"><table><thead><tr><th>Item</th><th>Status</th></tr></thead><tbody>
${result.checklist.map((c) => `<tr><td>${e(c.title)}</td><td><span class="tag ${STATUS_CLASS[c.status]}">${STATUS_WORDS[c.status]}</span></td></tr>`).join("\n")}
</tbody></table></div>

<h2>About this review</h2>
<div class="card">
<p>This summary was produced by an automated tool that reads the project's source code. It checks for a fixed list of common problems. It does not test the running system, and it cannot find every kind of problem.</p>
${notChecked ? `<p class="muted">${notChecked} check(s) did not run on this project, so those areas were not reviewed.</p>` : ""}
<p class="muted">"Not confirmed" means the item cannot be verified from the code alone and should be confirmed separately.</p>
</div>`;

  return page(`Code review summary: ${result.project.name}`, body, brandCss(options.brand));
}
