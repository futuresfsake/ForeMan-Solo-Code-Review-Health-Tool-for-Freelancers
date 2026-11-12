/*
 * Minimal glob support: `*`, `**`, `?`. Paths always use forward slashes.
 *
 * Patterns come from `foreman.config.json`, which may belong to a project you
 * did not write. They are matched by stepping through the text once per
 * pattern element, never by building a regular expression: a pattern such as
 * `*a*a*a*a*a*a*b` makes a backtracking matcher take longer than anyone will
 * wait, and that would let a config file stall the scan.
 */

type Token =
  | { kind: "lit"; ch: string }
  /** `?`: one character that is not a slash. */
  | { kind: "one" }
  /** `*`: any run of characters inside one path segment. */
  | { kind: "seg" }
  /** `**`: any run of characters, slashes included. */
  | { kind: "any" }
  /** Start of a `**` + `/` group, which stands for zero or more whole folders: enter it, or jump past its three tokens. */
  | { kind: "opt" };

function compile(glob: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          tokens.push({ kind: "opt" }, { kind: "any" }, { kind: "lit", ch: "/" });
        } else {
          tokens.push({ kind: "any" });
        }
      } else {
        tokens.push({ kind: "seg" });
      }
    } else if (c === "?") {
      tokens.push({ kind: "one" });
    } else {
      tokens.push({ kind: "lit", ch: c });
    }
  }
  return tokens;
}

/** Adds every position reachable without reading a character. Steps only go forward, so one pass is enough. */
function settle(active: Uint8Array, tokens: Token[]): void {
  for (let i = 0; i < tokens.length; i++) {
    if (!active[i]) continue;
    const kind = tokens[i]!.kind;
    if (kind === "seg" || kind === "any") active[i + 1] = 1;
    else if (kind === "opt") {
      active[i + 1] = 1; // enter the group: some folders, then a slash
      active[i + 3] = 1; // or skip it: no folders at all
    }
  }
}

/** True when the whole of `text` matches the glob. Time grows with pattern length times text length, never faster. */
export function globMatch(glob: string, text: string): boolean {
  const tokens = compile(glob);
  let active = new Uint8Array(tokens.length + 1);
  active[0] = 1;
  settle(active, tokens);
  for (const ch of text) {
    const next = new Uint8Array(tokens.length + 1);
    let any = false;
    for (let i = 0; i < tokens.length; i++) {
      if (!active[i]) continue;
      const token = tokens[i]!;
      let to = -1;
      if (token.kind === "lit") to = ch === token.ch ? i + 1 : -1;
      else if (token.kind === "one") to = ch !== "/" ? i + 1 : -1;
      else if (token.kind === "seg") to = ch !== "/" ? i : -1;
      else if (token.kind === "any") to = i;
      // "opt" reads nothing: settle() has already moved on from it.
      if (to !== -1) {
        next[to] = 1;
        any = true;
      }
    }
    if (!any) return false;
    settle(next, tokens);
    active = next;
  }
  return active[tokens.length] === 1;
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
    return rel.split("/").some((segment) => globMatch(p, segment));
  }
  return globMatch(p, rel) || globMatch(`${p}/**`, rel);
}
