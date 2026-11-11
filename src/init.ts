import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE } from "./config.js";

const STARTER_CONFIG = {
  failUnder: 0,
  ignorePaths: [],
  authMiddlewareNames: [],
  checklist: { attest: {} },
  report: { projectName: "", preparedBy: "", clientName: "" },
};

const IGNORE_LINES = [".foreman/", "foreman-report/"];

/**
 * A scheduled scan is how "ongoing care" works without any hosted service:
 * GitHub runs it weekly and emails the repository owner when it fails.
 */
const WORKFLOW = `# Runs Foreman Solo on every push to the default branch and once a week.
# A weekly run catches newly published dependency vulnerabilities in code
# that has not changed. GitHub notifies you when the job fails.
#
# Note: this uses the foreman-solo package from npm. Until it is published,
# replace the "npx" step with a checkout and build of the tool.
name: Foreman Solo

on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1" # Mondays 06:00 UTC
  workflow_dispatch:

permissions:
  contents: read

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Scan
        run: npx --yes foreman-solo scan --no-history --report html --fail-under 70
      - name: Keep the report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: foreman-report
          path: foreman-report/
          retention-days: 30
`;

export interface InitResult {
  created: string[];
  skipped: string[];
}

/** Writes starter files into a project. Existing files are never overwritten. */
export function initProject(root: string, options: { ci: boolean }): InitResult {
  const result: InitResult = { created: [], skipped: [] };

  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) {
      result.skipped.push(rel);
      return;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    result.created.push(rel);
  };

  write(CONFIG_FILE, `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`);

  const ignoreFile = path.join(root, ".gitignore");
  const existing = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "";
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORE_LINES.filter((l) => !present.has(l) && !present.has(l.replace(/\/$/, "")));
  if (missing.length > 0) {
    const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(ignoreFile, `${existing}${prefix}${missing.join("\n")}\n`);
    result.created.push(`.gitignore (added ${missing.join(", ")})`);
  }

  if (options.ci) write(".github/workflows/foreman-solo.yml", WORKFLOW);
  return result;
}
