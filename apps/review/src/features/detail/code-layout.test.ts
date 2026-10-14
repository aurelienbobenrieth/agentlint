import { describe, expect, it } from "vitest";
import { codeSegments } from "./code-layout";

describe("collapsed code", () => {
  it("keeps three lines around a finding in a 418-line file", () => {
    expect(codeSegments({ length: 418, ranges: [{ start: 263, end: 267 }] })).toEqual([
      { kind: "gap", start: 1, end: 259 },
      { kind: "lines", start: 260, end: 270 },
      { kind: "gap", start: 271, end: 418 },
    ]);
  });
  it("merges overlapping contexts and keeps a short gap readable", () => {
    expect(
      codeSegments({
        length: 30,
        ranges: [
          { start: 10, end: 12 },
          { start: 18, end: 19 },
        ],
      }),
    ).toEqual([{ kind: "lines", start: 1, end: 30 }]);
  });
  it("keeps file-level findings bounded and handles an empty source", () => {
    expect(codeSegments({ length: 0, ranges: [] })).toEqual([]);
    expect(codeSegments({ length: 100, ranges: [] })).toEqual([
      { kind: "lines", start: 1, end: 4 },
      { kind: "gap", start: 5, end: 100 },
    ]);
  });
});
