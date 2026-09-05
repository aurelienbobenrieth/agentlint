import { describe, expect, it } from "vitest";
import { ruleIds } from "./flags.js";

describe("ruleIds", () => {
  it("returns an empty list when the flag is absent", () => {
    expect(ruleIds([])).toEqual([]);
  });

  it("accepts repeated occurrences", () => {
    expect(ruleIds(["a", "b"])).toEqual(["a", "b"]);
  });

  it("still splits comma-separated values", () => {
    expect(ruleIds(["a,b", " c , d "])).toEqual(["a", "b", "c", "d"]);
  });

  it("drops empty entries and duplicates", () => {
    expect(ruleIds(["a,,b", "", "a"])).toEqual(["a", "b"]);
  });
});
