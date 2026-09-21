// @ts-check
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { commentableByFile, commentableLines, isCommentable } from "../src/diff.mjs";

const fixture = new URL("./fixtures/pulls-files.json", import.meta.url);

describe("commentableLines", () => {
  it("returns nothing without a patch", () => {
    expect(commentableLines(undefined).size).toBe(0);
    expect(commentableLines("").size).toBe(0);
  });

  it("counts added and context lines on the right side, skipping deletions", () => {
    const patch = ["@@ -1,4 +1,5 @@", " a", "-b", "+b2", "+b3", " c", " d"].join("\n");
    expect([...commentableLines(patch)]).toEqual([1, 2, 3, 4, 5]);
  });

  it("follows multiple hunks and ignores the no-newline marker", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      " a",
      "+b",
      "\\ No newline at end of file",
      "@@ -10,2 +20,3 @@",
      " x",
      "+y",
      "+z",
    ].join("\n");
    expect([...commentableLines(patch)]).toEqual([1, 2, 20, 21, 22]);
  });

  it("handles a hunk header without a count", () => {
    expect([...commentableLines("@@ -0,0 +1 @@\n+only")]).toEqual([1]);
  });
});

describe("commentableByFile", () => {
  it("maps every present file, with an empty set for files without a patch", async () => {
    const files = JSON.parse(await readFile(fixture, "utf8"));
    const map = commentableByFile(files);
    expect([...map.keys()]).toEqual([
      "src/vendor/legacy-parser.js",
      "src/payments/capture-order.ts",
      "assets/logo.png",
    ]);
    expect([...(map.get("src/vendor/legacy-parser.js") ?? [])]).toEqual([1, 2, 3, 4]);
    expect([...(map.get("src/payments/capture-order.ts") ?? [])]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(map.get("assets/logo.png")?.size).toBe(0);
    expect(isCommentable(map, { file: "src/vendor/legacy-parser.js", line: 3 })).toBe(true);
    expect(isCommentable(map, { file: "src/vendor/legacy-parser.js", line: 9 })).toBe(false);
    expect(isCommentable(map, { file: "src/migrations/2026-07-drop-legacy-users.ts", line: 4 })).toBe(false);
  });
});
