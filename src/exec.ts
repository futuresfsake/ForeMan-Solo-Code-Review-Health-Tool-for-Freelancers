import fs from "node:fs";
import path from "node:path";

const WINDOWS = process.platform === "win32";

function inside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Finds a program on PATH and returns its absolute path, or null.
 *
 * Programs are never started by bare name. On Windows a bare name is looked up
 * in the current folder before PATH, so a project that ships its own `git.exe`
 * or `npm.cmd` would have it run by a scan of that project. Looking the program
 * up here, and skipping every PATH entry that is relative, empty or inside the
 * project being scanned, closes that on every platform (NFR-07).
 */
export function findProgram(name: string, options: { avoid?: string; extensions?: string[] } = {}): string | null {
  const extensions = WINDOWS ? (options.extensions ?? [".exe"]) : [""];
  const avoid = options.avoid ? path.resolve(options.avoid) : undefined;
  for (const raw of (process.env.PATH ?? "").split(path.delimiter)) {
    const entry = raw.replace(/^"(.*)"$/, "$1");
    // "", "." and other relative entries all mean "wherever the command is run from".
    if (entry === "" || !path.isAbsolute(entry)) continue;
    const dir = path.resolve(entry);
    if (avoid && inside(avoid, dir)) continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (!WINDOWS) fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // not here; keep looking
      }
    }
  }
  return null;
}

/**
 * The environment for every child process. `NoDefaultCurrentDirectoryInExePath`
 * tells Windows not to look in the current folder when a child (for example
 * `npm.cmd` starting `node`) runs a program by bare name.
 */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() !== "nodefaultcurrentdirectoryinexepath") env[key] = value;
  }
  env.NoDefaultCurrentDirectoryInExePath = "1";
  return env;
}

/** The Windows command interpreter by absolute path, for the one program (`npm.cmd`) that needs it. */
export function windowsShell(): string {
  const comspec = process.env.ComSpec;
  if (comspec && path.isAbsolute(comspec)) return comspec;
  return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
}

/** Characters that would change the meaning of a quoted path on a Windows command line. */
export const UNSAFE_IN_SHELL = /["%!^&|<>\r\n]/;
