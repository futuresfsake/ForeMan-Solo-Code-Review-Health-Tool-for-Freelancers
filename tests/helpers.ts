import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { mergeConfig } from "../src/config.js";
import { scanProject } from "../src/scan.js";
import type { AuditRunner, ScanResult } from "../src/types.js";

const created: string[] = [];

afterAll(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

/** Writes a throwaway project to a temp folder and returns its path. */
export function project(files: Record<string, string>, parent?: string): string {
  const dir = parent ?? fs.mkdtempSync(path.join(os.tmpdir(), "foreman-solo-test-"));
  if (!parent) created.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

export function tempDir(): string {
  return project({});
}

export const NOW = new Date("2026-01-02T03:04:05.000Z");

export function scan(files: Record<string, string>, config: Record<string, unknown> = {}, audit?: AuditRunner): ScanResult {
  return scanProject(project(files), { config: mergeConfig(config), audit, now: NOW, toolVersion: "test" });
}

/** Rule IDs of the open (unsuppressed) findings. */
export function ids(result: ScanResult): string[] {
  return result.findings.filter((f) => !f.suppressed).map((f) => f.ruleId);
}

export const PKG = JSON.stringify({ name: "fixture-app", dependencies: { express: "^4.19.0" } });

/**
 * Fake credentials are assembled at runtime so that no secret-shaped string
 * exists in this repository.
 */
export const FAKE = {
  aws: "AKIA" + "ABCDEFGHIJKLMNOP",
  stripe: "sk_" + "live_" + "a1B2c3D4e5F6g7H8i9J0",
  github: "ghp_" + "a".repeat(36),
};
