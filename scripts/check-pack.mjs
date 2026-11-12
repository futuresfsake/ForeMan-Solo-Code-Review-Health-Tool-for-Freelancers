// Fails when `npm pack` would ship anything other than the built tool, the
// README, the licence and package.json. Run by `npm run check` and by CI, so a
// stray file (a report, a local config, a test fixture) never reaches npm.
import { execFileSync } from "node:child_process";

const ALLOWED = /^(dist\/|README\.md$|LICENSE$|package\.json$)/;

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this through npm: npm run check:pack");
  process.exit(2);
}
// npm is started through the Node that is already running, by the path npm
// itself provided, so nothing is looked up by name.
const out = execFileSync(process.execPath, [npmCli, "pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" });
const files = JSON.parse(out)[0].files.map((f) => f.path);
const unexpected = files.filter((p) => !ALLOWED.test(p));
if (files.length === 0 || !files.some((p) => p === "dist/bin.js")) {
  console.error("The package has no dist/bin.js. Run `npm run build` first.");
  process.exit(1);
}
if (unexpected.length > 0) {
  console.error(`Unexpected files in the package:\n  ${unexpected.join("\n  ")}`);
  process.exit(1);
}
console.log(`Package contents: ${files.length} files, all expected.`);
