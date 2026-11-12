import fs from "node:fs";
import path from "node:path";
import { writeInside } from "./fsafe.js";
import type { ScanResult, Trend } from "./types.js";

interface HistoryEntry {
  scannedAt: string;
  score: number;
  findingCount: number;
}

const MAX_ENTRIES = 200;
const MAX_HISTORY_BYTES = 512 * 1024;
const HISTORY_FILE = path.join(".foreman", "history.json");
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * The history file sits in the project, so it may not be ours. Only entries
 * with the exact expected shape are kept, and only the three known fields of
 * each, so nothing a project put there is printed or written back.
 */
function read(root: string): HistoryEntry[] {
  try {
    const file = path.join(root, HISTORY_FILE);
    if (fs.statSync(file).size > MAX_HISTORY_BYTES) return [];
    const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data)) return [];
    const entries: HistoryEntry[] = [];
    for (const e of data as Partial<HistoryEntry>[]) {
      if (typeof e?.scannedAt !== "string" || !TIMESTAMP.test(e.scannedAt)) continue;
      if (typeof e.score !== "number" || !Number.isFinite(e.score) || e.score < 0 || e.score > 100) continue;
      const count = typeof e.findingCount === "number" && Number.isFinite(e.findingCount) && e.findingCount >= 0 ? Math.round(e.findingCount) : 0;
      entries.push({ scannedAt: e.scannedAt, score: Math.round(e.score), findingCount: count });
    }
    return entries;
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
    // Refuses to write through a link, so a project cannot aim this at another file.
    writeInside(root, HISTORY_FILE, `${JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2)}\n`);
  } catch (err) {
    result.warnings.push(`Could not write scan history: ${(err as Error).message}`);
  }
}
