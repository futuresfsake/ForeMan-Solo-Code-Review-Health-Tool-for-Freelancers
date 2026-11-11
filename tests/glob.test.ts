import { describe, expect, it } from "vitest";
import { matchesPath } from "../src/glob.js";

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
