import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { matchesPath } from "./glob.js";
import type { ParsedFile, TextFile } from "./types.js";

const SOURCE_EXT = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".cts", ".mts", ".tsx"]);
const TEXT_EXT = new Set([".json", ".yml", ".yaml"]);
const ALWAYS_SKIP = new Set(["node_modules", ".git", ".foreman", "foreman-report", ".next", ".nuxt", ".turbo", ".cache", "bower_components"]);
const SKIP_TEXT_FILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "tsconfig.json"]);
const MAX_FILE_BYTES = 1024 * 1024;

export const ENV_FILE = /^\.env(\..+)?$/;

/** True for a file name the loader treats as source code. */
export function isSourceFileName(name: string): boolean {
  return SOURCE_EXT.has(path.extname(name).toLowerCase()) && !name.endsWith(".d.ts");
}

export interface LoadedProject {
  files: ParsedFile[];
  textFiles: TextFile[];
  filesWithSyntaxErrors: number;
  warnings: string[];
}

function scriptKind(ext: string): ts.ScriptKind {
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return ts.ScriptKind.TS;
  return ts.ScriptKind.JSX;
}

/**
 * Reads and parses every source file under `root`. Nothing is executed. A
 * file that cannot be read or parsed becomes a warning, never a crash.
 */
export function loadProject(root: string, ignorePaths: string[]): LoadedProject {
  const out: LoadedProject = { files: [], textFiles: [], filesWithSyntaxErrors: 0, warnings: [] };

  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      out.warnings.push(`Could not read directory ${path.relative(root, dir) || "."}.`);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name)) continue;
        if (ignorePaths.some((p) => matchesPath(p, rel))) continue;
        visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const isEnv = ENV_FILE.test(entry.name);
      const isSource = isSourceFileName(entry.name);
      const isText = isEnv || (TEXT_EXT.has(ext) && !SKIP_TEXT_FILES.has(entry.name));
      if (!isSource && !isText) continue;
      // Env files are always looked at: ignoring them would hide the check.
      if (!isEnv && ignorePaths.some((p) => matchesPath(p, rel))) continue;

      let text: string;
      try {
        if (fs.statSync(abs).size > MAX_FILE_BYTES) {
          if (isSource) out.warnings.push(`${rel}: skipped, larger than 1 MB.`);
          continue;
        }
        text = fs.readFileSync(abs, "utf8");
      } catch {
        out.warnings.push(`${rel}: could not be read.`);
        continue;
      }

      if (!isSource) {
        out.textFiles.push({ path: rel, abs, text });
        continue;
      }
      try {
        const ast = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKind(ext));
        const errors = (ast as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length ?? 0;
        if (errors > 0) {
          out.filesWithSyntaxErrors++;
          out.warnings.push(`${rel}: ${errors} syntax error(s); results for this file may be incomplete.`);
        }
        out.files.push({ path: rel, abs, text, ast });
      } catch (err) {
        out.filesWithSyntaxErrors++;
        out.warnings.push(`${rel}: could not be parsed (${(err as Error).message}).`);
      }
    }
  };

  visit(root);
  return out;
}

export function readPackageJson(root: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
