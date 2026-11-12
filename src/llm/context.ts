import path from "node:path";
import type { Finding, ParsedFile, RouteInfo } from "../types.js";
import type { DiffFile } from "./diff.js";

export interface RelatedFile {
  path: string;
  text: string;
  /** Why it is included, shown to the model. */
  why: "imported by the change" | "imports the changed file";
  truncated: boolean;
}

export interface ReviewContext {
  changed: DiffFile[];
  related: RelatedFile[];
  routes: RouteInfo[];
  /** Open findings from the static pass in the changed files. */
  staticFindings: Finding[];
  /** Related files left out to stay within the size budget. */
  omitted: string[];
}

export interface ContextInput {
  changed: DiffFile[];
  files: ParsedFile[];
  routes: RouteInfo[];
  findings: Finding[];
  /** Total characters allowed for related files. */
  maxRelatedChars: number;
  /** Characters allowed for any single related file. */
  maxFileChars: number;
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
// The space before and after "(" is matched in one place each, so a long run of
// spaces after "import" cannot be split in many ways (which made matching slow).
const IMPORT = /(?:from|import|require)\s*(?:\(\s*)?['"](\.[^'"]*)['"]/g;

function resolveImport(from: string, spec: string, known: Set<string>): string | undefined {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  const stripped = base.replace(/\.[mc]?js$/, "");
  const candidates = [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => `${base}/index${e}`),
    ...EXTENSIONS.map((e) => stripped + e),
  ];
  return candidates.find((c) => known.has(c));
}

export function importsOf(file: ParsedFile, known: Set<string>): string[] {
  const out = new Set<string>();
  for (const m of file.text.matchAll(IMPORT)) {
    const resolved = resolveImport(file.path, m[1]!, known);
    if (resolved && resolved !== file.path) out.add(resolved);
  }
  return [...out];
}

/**
 * Gathers what a reviewer would open next to the diff (FR-20): the files the
 * change imports, the files that import it, the routes it touches, and what
 * the static scan already found there. Only parsed source files are used, so
 * `.env` and other settings files are never part of the context.
 */
export function buildContext(input: ContextInput): ReviewContext {
  const byPath = new Map(input.files.map((f) => [f.path, f]));
  const known = new Set(byPath.keys());
  const changedPaths = new Set(input.changed.map((c) => c.path));

  const imported: string[] = [];
  const importers: string[] = [];
  for (const c of input.changed) {
    const file = byPath.get(c.path);
    if (file) imported.push(...importsOf(file, known));
  }
  for (const f of input.files) {
    if (changedPaths.has(f.path)) continue;
    if (importsOf(f, known).some((p) => changedPaths.has(p))) importers.push(f.path);
  }

  const ordered: { path: string; why: RelatedFile["why"] }[] = [];
  const seen = new Set<string>(changedPaths);
  for (const p of imported) if (!seen.has(p)) (seen.add(p), ordered.push({ path: p, why: "imported by the change" }));
  for (const p of importers) if (!seen.has(p)) (seen.add(p), ordered.push({ path: p, why: "imports the changed file" }));

  const related: RelatedFile[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const item of ordered) {
    const text = byPath.get(item.path)!.text;
    const clipped = text.length > input.maxFileChars;
    const size = Math.min(text.length, input.maxFileChars);
    if (used + size > input.maxRelatedChars) {
      omitted.push(item.path);
      continue;
    }
    used += size;
    related.push({ path: item.path, text: clipped ? text.slice(0, input.maxFileChars) : text, why: item.why, truncated: clipped });
  }

  return {
    changed: input.changed,
    related,
    routes: input.routes.filter((r) => changedPaths.has(r.file)),
    staticFindings: input.findings.filter((f) => !f.suppressed && changedPaths.has(f.file)),
    omitted,
  };
}
