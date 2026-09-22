import { describe, expect, it } from "vitest";
import { parseGitRawStatus, parseUnifiedHunks } from "./service.js";

describe("parseGitRawStatus", () => {
  const zero = "0".repeat(40);
  const blob = "a".repeat(40);

  it("reads status, paths, modes, and the baseline blob", () => {
    const raw = [
      `:000000 100644 ${zero} ${zero} A`,
      "new.ts",
      `:100644 100644 ${blob} ${zero} M`,
      "changed.ts",
      `:100644 000000 ${blob} ${zero} D`,
      "gone.ts",
      `:100644 100644 ${blob} ${blob} R100`,
      "old.ts",
      "moved.ts",
      `:160000 160000 ${blob} ${zero} M`,
      "vendor/sub",
      "",
    ].join("\0");
    expect(parseGitRawStatus(raw)).toEqual([
      { status: "added", path: "new.ts", beforeMode: "000000", afterMode: "100644", beforeBlob: zero },
      { status: "modified", path: "changed.ts", beforeMode: "100644", afterMode: "100644", beforeBlob: blob },
      { status: "deleted", path: "gone.ts", beforeMode: "100644", afterMode: "000000", beforeBlob: blob },
      {
        status: "renamed",
        previousPath: "old.ts",
        path: "moved.ts",
        beforeMode: "100644",
        afterMode: "100644",
        beforeBlob: blob,
      },
      { status: "modified", path: "vendor/sub", beforeMode: "160000", afterMode: "160000", beforeBlob: blob },
    ]);
  });

  it("keeps a backslash, which Git only emits as part of a file name", () => {
    expect(parseGitRawStatus(`:100644 100644 ${blob} ${zero} M\0src/odd\\name.ts\0`)[0]?.path).toBe("src/odd\\name.ts");
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
