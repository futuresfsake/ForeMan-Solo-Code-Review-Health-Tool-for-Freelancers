/** Minimal glob support: `*`, `**`, `?`. Paths always use forward slashes. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * A pattern with no slash matches any single path segment (`node_modules`,
 * `*.test.*`). A pattern with a slash matches the whole relative path, or a
 * directory prefix of it.
 */
export function matchesPath(pattern: string, relPath: string): boolean {
  const p = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const rel = relPath.replace(/\\/g, "/");
  if (p === "") return false;
  if (!p.includes("/")) {
    const re = globToRegExp(p);
    return rel.split("/").some((segment) => re.test(segment));
  }
  return globToRegExp(p).test(rel) || globToRegExp(`${p}/**`).test(rel);
}
