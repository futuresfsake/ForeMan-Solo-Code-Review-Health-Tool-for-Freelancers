import type { ScanResult } from "../types.js";
import { DISCLAIMER, SEVERITY_LABEL, TREND_LABEL, open, verdict, type SummaryRow } from "./text.js";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = escapeHtml;

// Self-contained on purpose: no scripts, fonts or other external requests.
const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1a1d21;--muted:#5c6470;--line:#dfe3e8;--red:#b42318;--amber:#8a5a00;--green:#1a7f4b;--accent:#2f5bd8}
@media (prefers-color-scheme:dark){:root{--bg:#14171b;--card:#1d2126;--text:#e8eaed;--muted:#9aa3ae;--line:#2e343c;--red:#ff8a80;--amber:#f0b849;--green:#5fd39a;--accent:#8fb0ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 16px 48px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px}
.summary{display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin-top:20px}
.score{font-size:44px;font-weight:700;line-height:1}.score small{font-size:18px;font-weight:400;color:var(--muted)}
.good{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
tr:last-child td{border-bottom:0}code{font:13px ui-monospace,Consolas,monospace;overflow-wrap:anywhere}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.fix{color:var(--muted);margin-top:4px}
footer{margin-top:32px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:16px}
ul{margin:0;padding-left:20px}a{color:var(--accent)}
`;

export function page(title: string, body: string, extraCss = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<style>${CSS}${extraCss}</style>
</head>
<body>
<main>
${body}
<footer>${e(DISCLAIMER)}</footer>
</main>
</body>
</html>
`;
}

function scoreClass(score: number): string {
  return score >= 80 ? "good" : score >= 50 ? "warn" : "bad";
}

export function renderHtml(result: ScanResult): string {
  const findings = open(result);
  const suppressed = result.findings.filter((f) => f.suppressed);
  const trend = result.previousScan ? `${TREND_LABEL[result.trend]} (previous score ${result.previousScan.score})` : "first scan";
  const sevClass = { blocker: "bad", "should-fix": "warn", "nice-to-have": "muted" } as const;
  const statusClass = { pass: "good", fail: "bad", unverified: "warn" } as const;

  const checklist = result.checklist
    .map((c) => `<tr><td><strong>${e(c.id)}</strong> ${e(c.title)}</td><td><span class="tag ${statusClass[c.status]}">${e(c.status)}</span></td><td class="muted">${e(c.note ?? "")}</td></tr>`)
    .join("\n");

  const findingRows = findings
    .map(
      (f) => `<tr>
<td><span class="tag ${sevClass[f.severity]}">${e(SEVERITY_LABEL[f.severity])}</span></td>
<td>${e(f.message)}<div class="fix">Why it matters: ${e(f.risk)}</div><div class="fix">Fix: ${e(f.remediation)}</div></td>
<td><code>${e(f.file)}:${f.line}</code><div class="muted"><code>${e(f.ruleId)}</code></div></td>
<td>${e(f.confidence)}</td>
</tr>`,
    )
    .join("\n");

  const notes = [
    ...result.coverage.rulesSkipped.map((s) => `Not checked: <code>${e(s.id)}</code> (${e(s.reason)})`),
    ...result.warnings.map((w) => `Warning: ${e(w)}`),
  ];

  const body = `<h1>Code health report: ${e(result.project.name)}</h1>
<div class="muted">Scanned ${e(result.scannedAt.slice(0, 10))} with Foreman Solo ${e(result.toolVersion)}</div>
<div class="card summary">
<div class="score ${scoreClass(result.score)}">${result.score}<small> / 100</small></div>
<div><div><strong>${e(verdict(result))}</strong></div>
<div class="muted">${findings.length} open finding(s), ${suppressed.length} suppressed. Trend: ${e(trend)}.</div></div>
</div>

<h2>Go-live checklist</h2>
<div class="card scroll"><table><thead><tr><th>Item</th><th>Status</th><th>Note</th></tr></thead><tbody>
${checklist}
</tbody></table></div>

<h2>Findings (${findings.length})</h2>
<div class="card scroll">${
    findings.length === 0
      ? "No open findings."
      : `<table><thead><tr><th>Severity</th><th>What and how to fix it</th><th>Where</th><th>Confidence</th></tr></thead><tbody>
${findingRows}
</tbody></table>`
  }</div>
${
  suppressed.length === 0
    ? ""
    : `
<h2>Suppressed (${suppressed.length})</h2>
<div class="card scroll"><table><thead><tr><th>Rule</th><th>Where</th><th>Reason given</th></tr></thead><tbody>
${suppressed.map((f) => `<tr><td><code>${e(f.ruleId)}</code></td><td><code>${e(f.file)}:${f.line}</code></td><td>${e(f.suppressed!.reason)}</td></tr>`).join("\n")}
</tbody></table></div>`
}

<h2>What was checked</h2>
<div class="card">
<p>${result.coverage.filesScanned} file(s) and ${result.coverage.routesFound} route(s) were read. Nothing was executed.</p>
<p class="muted">Rules run: ${result.coverage.rulesRun.map((r) => `<code>${e(r)}</code>`).join(", ") || "none"}</p>
${notes.length ? `<ul>${notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
</div>`;

  return page(`Code health report: ${result.project.name}`, body);
}

export function renderSummaryHtml(rows: SummaryRow[], generatedAt: string): string {
  const body = `<h1>Project health summary</h1>
<div class="muted">Generated ${e(generatedAt.slice(0, 10))} with Foreman Solo</div>
<h2>Projects (${rows.length})</h2>
<div class="card scroll"><table><thead><tr><th>Project</th><th>Score</th><th>Trend</th><th>Blockers</th><th>Ready to ship</th><th>Previous scan</th></tr></thead><tbody>
${rows
  .map(({ result, dir }) => {
    const blockers = open(result).filter((f) => f.severity === "blocker").length;
    return `<tr><td><a href="${e(encodeURI(dir))}/report.html">${e(result.project.name)}</a></td><td class="${scoreClass(result.score)}"><strong>${result.score}</strong></td><td>${e(TREND_LABEL[result.trend])}</td><td>${blockers}</td><td>${result.readyToShip ? "yes" : "no"}</td><td>${e(result.previousScan ? result.previousScan.scannedAt.slice(0, 10) : "never")}</td></tr>`;
  })
  .join("\n")}
</tbody></table></div>`;
  return page("Project health summary", body);
}
