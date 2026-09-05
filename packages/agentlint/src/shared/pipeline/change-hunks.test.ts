import { describe, expect, it } from "vitest";
import { fixtureHunks } from "./change-hunks.js";
import { normalizeChangeFixture } from "./rule-tester.js";

describe("normalized fixture evidence", () => {
  it("leaves an unchanged destructive operation as context", () => {
    const change = normalizeChangeFixture({
      before: { "m.sql": "DROP TABLE old;\nSELECT 1;\n" },
      after: { "m.sql": "DROP TABLE old;\nSELECT 2;\n" },
    });
    expect(change.files[0]?.hunks[0]?.lines).toEqual([
      { kind: "context", content: "DROP TABLE old;" },
      { kind: "deletion", content: "SELECT 1;" },
      { kind: "addition", content: "SELECT 2;" },
    ]);
  });
  it("uses correct line counts for additions, deletions and empty files", () => {
    expect(fixtureHunks(undefined, "hello\n")).toEqual([
      { oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: "addition", content: "hello" }] },
    ]);
    expect(fixtureHunks("hello\n", undefined)[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0 });
    expect(fixtureHunks(undefined, "")).toEqual([]);
  });
  it("splits distant edits into separate three-context-line hunks", () => {
    const before = Array.from({ length: 30 }, (_, index) => String(index));
    const after = [...before];
    after[2] = "changed";
    after[27] = "also changed";
    const hunks = fixtureHunks(before.join("\n"), after.join("\n"));
    expect(hunks).toHaveLength(2);
    expect(hunks.map((hunk) => hunk.newStart)).toEqual([1, 25]);
  });
});
