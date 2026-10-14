import { describe, expect, it } from "vitest";
import { codeSegments } from "./code-layout";

describe("collapsed code", () => {
  it.each([
    { length: 20, end: 20 },
    { length: 30, end: 30 },
  ])("shows every line in a $length-line file with a highlighted range", ({ length, end }) => {
    expect(codeSegments({ length, ranges: [{ start: 1, end: 1 }] })).toEqual([{ kind: "lines", start: 1, end }]);
  });
  it("folds a highlighted file above the 30-line threshold", () => {
    expect(codeSegments({ length: 31, ranges: [{ start: 1, end: 1 }] })).toEqual([
      { kind: "lines", start: 1, end: 4 },
      { kind: "gap", start: 5, end: 31 },
    ]);
  });
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
        length: 60,
        ranges: [
          { start: 10, end: 12 },
          { start: 18, end: 19 },
        ],
      }),
    ).toEqual([
      { kind: "lines", start: 1, end: 22 },
      { kind: "gap", start: 23, end: 60 },
    ]);
  });
  it("keeps an eight-line gap readable but folds a nine-line gap", () => {
    expect(
      codeSegments({
        length: 60,
        ranges: [
          { start: 14, end: 14 },
          { start: 29, end: 29 },
        ],
      }),
    ).toEqual([
      { kind: "gap", start: 1, end: 10 },
      { kind: "lines", start: 11, end: 32 },
      { kind: "gap", start: 33, end: 60 },
    ]);
    expect(
      codeSegments({
        length: 60,
        ranges: [
          { start: 14, end: 14 },
          { start: 30, end: 30 },
        ],
      }),
    ).toEqual([
      { kind: "gap", start: 1, end: 10 },
      { kind: "lines", start: 11, end: 17 },
      { kind: "gap", start: 18, end: 26 },
      { kind: "lines", start: 27, end: 33 },
      { kind: "gap", start: 34, end: 60 },
    ]);
  });
  it("shows every line when there is no highlighted range", () => {
    expect(codeSegments({ length: 100, ranges: [] })).toEqual([{ kind: "lines", start: 1, end: 100 }]);
  });
  it("handles an empty source", () => {
    expect(codeSegments({ length: 0, ranges: [] })).toEqual([]);
  });
});
