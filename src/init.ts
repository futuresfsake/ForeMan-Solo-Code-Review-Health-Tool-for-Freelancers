import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE } from "./config.js";
import { writeInside } from "./fsafe.js";
import { toolVersion } from "./scan.js";

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
 *
 * The workflow is written the way this project's own CI is: read-only token,
 * actions pinned to a commit (a tag can be moved to different code, a commit
 * cannot), no git credentials left on disk, and one exact version of the tool.
 */
const workflow = (version: string): string => `# Runs Foreman Solo on every push to the default branch and once a week.
# A weekly run catches newly published dependency vulnerabilities in code
# that has not changed. GitHub notifies you when the job fails.
#
# IMPORTANT: this runs the foreman-solo package from npm, and that package is
# not published yet. Do not enable this workflow before it is: until then the
# name is free, and whoever registers it decides what this job runs. Check
# https://www.npmjs.com/package/foreman-solo links back to the project first.
# Until then, replace the "npx" step with a checkout and build of the tool.
#
# The actions below are pinned to a commit. Dependabot can keep them current:
# add a "github-actions" entry to .github/dependabot.yml.
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
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22
      - name: Scan
        run: npx --yes foreman-solo@${version} scan --no-history --report html --fail-under 70
      - name: Keep the report
        if: always()
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: foreman-report
          path: foreman-report/
          retention-days: 30
`;

export interface InitResult {
  created: string[];
  skipped: string[];
}

/**
 * Writes starter files into a project. Existing files are never overwritten,
 * and nothing is written through a link (see src/fsafe.ts).
 */
export function initProject(root: string, options: { ci: boolean }): InitResult {
  const result: InitResult = { created: [], skipped: [] };

  const write = (rel: string, content: string): void => {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) {
      result.skipped.push(rel);
      return;
    }
    writeInside(root, rel, content);
    result.created.push(rel);
  };

  write(CONFIG_FILE, `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`);

  const ignoreFile = path.join(root, ".gitignore");
  const existing = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "";
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORE_LINES.filter((l) => !present.has(l) && !present.has(l.replace(/\/$/, "")));
  if (missing.length > 0) {
    const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
    writeInside(root, ".gitignore", `${existing}${prefix}${missing.join("\n")}\n`);
    result.created.push(`.gitignore (added ${missing.join(", ")})`);
  }

  if (options.ci) write(".github/workflows/foreman-solo.yml", workflow(toolVersion()));
  return result;
}
