import fs from "node:fs";
import path from "node:path";

export class UnsafePathError extends Error {}

/**
 * Writes a file below `base` and returns its path. It refuses when the target
 * would land outside `base`, or when any existing part of the path below `base`
 * is a link.
 *
 * A project handed over as a folder can contain `.foreman`, `foreman-report`
 * or `.gitignore` as a link to somewhere else on the machine. Without this
 * check a scan of that project would overwrite whatever the link points at.
 */
export function writeInside(base: string, rel: string, content: string | Uint8Array): string {
  const root = path.resolve(base);
  const target = path.resolve(root, rel);
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UnsafePathError(`${rel} is outside ${root}, so it was not written.`);
  }

  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") break; // nothing below this exists yet
      throw err;
    }
    if (stat.isSymbolicLink()) {
      throw new UnsafePathError(`${path.relative(root, current)} is a link, so nothing was written through it. Remove the link and run again.`);
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  // O_NOFOLLOW (not available on Windows) also refuses a link created after the check above.
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(target, flags, 0o644);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  return target;
}

/**
 * Splits an output folder into a base that the user chose and the part below
 * it that may have come with a project. Inside the working folder the whole
 * path is checked for links; a folder elsewhere was named by the user (`--out`).
 */
export function writeReportFile(cwd: string, dir: string, name: string, content: string): string {
  const absCwd = path.resolve(cwd);
  const absDir = path.resolve(absCwd, dir);
  const rel = path.relative(absCwd, absDir);
  const below = rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  return below ? writeInside(absCwd, path.join(rel, name), content) : writeInside(absDir, name, content);
}
