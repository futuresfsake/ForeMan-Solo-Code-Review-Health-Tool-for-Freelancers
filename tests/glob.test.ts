import { describe, expect, it } from "vitest";
import { globMatch, matchesPath } from "../src/glob.js";

describe("matchesPath", () => {
  it("matches a bare name against any path segment", () => {
    expect(matchesPath("node_modules", "a/node_modules/b.js")).toBe(true);
    expect(matchesPath("dist", "src/distance.js")).toBe(false);
  });

  it("matches a slash-less glob against any segment", () => {
    expect(matchesPath("*.test.*", "src/user.test.ts")).toBe(true);
    expect(matchesPath("*.test.*", "src/user.ts")).toBe(false);
  });

  it("matches full paths, directory prefixes and **", () => {
    expect(matchesPath("tests/**", "tests/a/b.js")).toBe(true);
    expect(matchesPath("src/legacy", "src/legacy/old.js")).toBe(true);
    expect(matchesPath("src/*.js", "src/a/b.js")).toBe(false);
    expect(matchesPath("**/fixtures/**", "tests/fixtures/x.js")).toBe(true);
  });

  it("normalizes Windows separators", () => {
    expect(matchesPath("src\\legacy", "src/legacy/old.js")).toBe(true);
  });
});

/** The regular-expression matcher this replaced, kept as the reference the new one must agree with. */
function reference(glob: string): RegExp {
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

describe("globMatch", () => {
  it("gives the same answer as a regular expression on 100,000 random patterns and paths", () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pick = (alphabet: string[], max: number): string => Array.from({ length: rnd(max + 1) }, () => alphabet[rnd(alphabet.length)]!).join("");
    const mismatches: string[] = [];
    for (let i = 0; i < 100_000; i++) {
      const glob = pick(["a", "b", "/", "*", "*", "?", "."], 7);
      const text = pick(["a", "b", "/", "."], 8);
      if (globMatch(glob, text) !== reference(glob).test(text)) mismatches.push(`${JSON.stringify(glob)} on ${JSON.stringify(text)}`);
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it("answers at once on a pattern that stalls a backtracking matcher", () => {
    // A config file in a scanned project is untrusted; this pattern took minutes as a regular expression.
    const started = Date.now();
    expect(globMatch(`${"*a".repeat(30)}*b`, "a".repeat(200))).toBe(false);
    expect(matchesPath(`${"*a".repeat(30)}*b`, `src/${"a".repeat(200)}.js`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
