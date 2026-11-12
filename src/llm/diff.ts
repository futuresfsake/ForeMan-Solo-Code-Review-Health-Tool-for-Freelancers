import { execFileSync } from "node:child_process";

export class ReviewError extends Error {}

export interface DiffRow {
  kind: "+" | "-" | " " | "@";
  /** Line number in the new file; set for "+" and " " rows. */
  line?: number;
  text: string;
}

export interface DiffFile {
  /** Project-relative path with forward slashes. */
  path: string;
  rows: DiffRow[];
  /** New-file line numbers of added lines. */
  added: number[];
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parses unified diff text. Deleted files are skipped: there is nothing left to review. */
export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let newLine = 0;

  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const inHunk = oldLeft > 0 || newLeft > 0;

    if (!inHunk) {
      if (line.startsWith("diff --git ")) {
        current = null;
      } else if (line.startsWith("+++ ")) {
        const target = line.slice(4).replace(/\t.*$/, "");
        current = null;
        if (target !== "/dev/null") {
          current = { path: target.replace(/^b\//, ""), rows: [], added: [] };
          files.push(current);
        }
      } else if (current) {
        const m = HUNK.exec(line);
        if (m) {
          oldLeft = m[1] === undefined ? 1 : Number(m[1]);
          newLeft = m[3] === undefined ? 1 : Number(m[3]);
          newLine = Number(m[2]);
          current.rows.push({ kind: "@", text: line });
        }
      }
      continue;
    }

    if (!current) continue;
    const mark = line[0];
    if (mark === "+") {
      current.rows.push({ kind: "+", line: newLine, text: line.slice(1) });
      current.added.push(newLine);
      newLine++;
      newLeft--;
    } else if (mark === "-") {
      current.rows.push({ kind: "-", text: line.slice(1) });
      oldLeft--;
    } else if (mark === " " || line === "") {
      current.rows.push({ kind: " ", line: newLine, text: line.slice(1) });
      newLine++;
      newLeft--;
      oldLeft--;
    }
    // "\ No newline at end of file" and anything else is ignored.
  }
  return files.filter((f) => f.added.length > 0);
}

/**
 * The diff of the working tree against `base`, with paths relative to the
 * project folder. New files that are not yet tracked by git are not included.
 */
export function getDiff(root: string, base: string): string {
  if (base.startsWith("-")) throw new ReviewError(`Not a valid git reference: ${base}`);
  try {
    return execFileSync(
      "git",
      ["-C", root, "-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--relative", "--unified=3", base, "--"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    const stderr = String((err as { stderr?: unknown }).stderr ?? "");
    if (/not a git repository/i.test(stderr)) {
      throw new ReviewError("This folder is not a git repository, so there is no change to review.");
    }
    if (/unknown revision|bad revision|ambiguous argument/i.test(stderr)) {
      throw new ReviewError(`Git does not know "${base}". Pass a branch, tag or commit with --base.`);
    }
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ReviewError("git was not found on this machine.");
    throw new ReviewError(`git diff failed: ${stderr.trim().split("\n")[0] ?? "unknown error"}`);
  }
}

/** Renders a file's diff with new-file line numbers the model can quote back. */
export function renderNumbered(file: DiffFile): string {
  return file.rows
    .map((r) => {
      if (r.kind === "@") return r.text;
      if (r.kind === "-") return `-         ${r.text}`;
      return `${r.kind} [L${r.line}] ${r.text}`;
    })
    .join("\n");
}
