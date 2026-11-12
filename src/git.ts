import { spawnSync } from "node:child_process";

/**
 * A project handed over as a folder brings its own `.git/config`, and git will
 * run programs named there (a file-system monitor, content filters, diff
 * drivers). These options switch those off, so reading a repository never runs
 * anything the repository chose (NFR: "reads only; never executes project code").
 */
const BASE = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=", "-c", "core.pager=cat"];

export class UnsafeGitConfigError extends Error {}

/** Arguments for a git command that only reads the index and the object store. */
export function safeGitArgs(root: string, args: string[]): string[] {
  return ["-C", root, ...BASE, ...args];
}

/**
 * Extra `-c` options for commands that read file contents from the working
 * tree (`git diff`): every content filter configured for the repository is
 * replaced by nothing, whichever config file it came from.
 */
export function filterOverrides(root: string): string[] {
  const res = spawnSync("git", safeGitArgs(root, ["config", "-z", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"]), {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (res.error || typeof res.stdout !== "string") return [];
  const names = new Set<string>();
  for (const key of res.stdout.split("\0")) {
    if (!key) continue;
    const name = key.slice("filter.".length, key.lastIndexOf("."));
    // `-c key=value` splits at the first "=", so such a name could not be overridden safely.
    if (name === "" || /[=\n\r]/.test(name)) {
      throw new UnsafeGitConfigError("This repository's git settings define a content filter with an unusual name, so git diff was not run. Check the [filter] sections of .git/config.");
    }
    names.add(name);
  }
  const out: string[] = [];
  for (const name of names) {
    out.push("-c", `filter.${name}.clean=`, "-c", `filter.${name}.smudge=`, "-c", `filter.${name}.process=`, "-c", `filter.${name}.required=false`);
  }
  return out;
}

/** Flags for `git diff` that keep it from running external diff or text-conversion programs, or entering submodules. */
export const SAFE_DIFF_FLAGS = ["--no-ext-diff", "--no-textconv", "--ignore-submodules=all"];
