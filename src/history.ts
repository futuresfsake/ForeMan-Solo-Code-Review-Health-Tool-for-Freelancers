import fs from "node:fs";
import path from "node:path";
import type { ScanResult, Trend } from "./types.js";

interface HistoryEntry {
  scannedAt: string;
  score: number;
  findingCount: number;
}

const MAX_ENTRIES = 200;

function historyFile(root: string): string {
  return path.join(root, ".foreman", "history.json");
}

function read(root: string): HistoryEntry[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(historyFile(root), "utf8"));
    return Array.isArray(data) ? (data as HistoryEntry[]).filter((e) => typeof e?.score === "number" && typeof e?.scannedAt === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Fills in the trend from the previous scan and, unless disabled, appends
 * this scan to `.foreman/history.json` inside the project. Only timestamps,
 * scores and counts are stored, never code or findings.
 */
export function applyHistory(root: string, result: ScanResult, write: boolean): void {
  const entries = read(root);
  const previous = entries.at(-1);
  if (previous) {
    const trend: Trend = result.score > previous.score ? "up" : result.score < previous.score ? "down" : "flat";
    result.trend = trend;
    result.previousScan = { scannedAt: previous.scannedAt, score: previous.score };
  }
  if (!write) return;
  entries.push({
    scannedAt: result.scannedAt,
    score: result.score,
    findingCount: result.findings.filter((f) => !f.suppressed).length,
  });
  try {
    fs.mkdirSync(path.dirname(historyFile(root)), { recursive: true });
    fs.writeFileSync(historyFile(root), `${JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2)}\n`);
  } catch (err) {
    result.warnings.push(`Could not write scan history: ${(err as Error).message}`);
  }
}
