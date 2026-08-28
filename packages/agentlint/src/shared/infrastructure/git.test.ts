import { describe, expect, it } from "vitest";
import { parseGitNameStatus, parseUnifiedHunks } from "./git.js";

describe("parseGitNameStatus", () => {
  it("normalizes added, modified, deleted, and renamed paths", () => {
    expect(parseGitNameStatus("A\0new.ts\0M\0changed.ts\0D\0gone.ts\0R100\0old.ts\0moved.ts\0")).toEqual([
      { status: "added", path: "new.ts" },
      { status: "modified", path: "changed.ts" },
      { status: "deleted", path: "gone.ts" },
      { status: "renamed", previousPath: "old.ts", path: "moved.ts" },
    ]);
  });

  it("normalizes Windows separators", () => {
    expect(parseGitNameStatus("M\0src\\feature.ts\0")).toEqual([{ status: "modified", path: "src/feature.ts" }]);
  });
});

describe("parseUnifiedHunks", () => {
  it("parses additions, deletions, context, and multiple hunks", () => {
    const diff = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "@@ -10 +10,2 @@ section",
      " line",
      "+extra",
    ].join("\n");

    expect(parseUnifiedHunks(diff)).toEqual([
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: "context", content: "keep" },
          { kind: "deletion", content: "old" },
          { kind: "addition", content: "new" },
        ],
      },
      {
        oldStart: 10,
        oldLines: 1,
        newStart: 10,
        newLines: 2,
        lines: [
          { kind: "context", content: "line" },
          { kind: "addition", content: "extra" },
        ],
      },
    ]);
  });

  it("accepts zero line starts for pure file additions", () => {
    expect(parseUnifiedHunks("@@ -0,0 +1,2 @@\n+first\n+second")).toEqual([
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        lines: [
          { kind: "addition", content: "first" },
          { kind: "addition", content: "second" },
        ],
      },
    ]);
  });
});
