import { describe, expect, it } from "vitest";
import { fnv1a7 } from "./hash.js";

describe("fnv1a7", () => {
  it("produces a 7-char hex string", () => {
    const h = fnv1a7("test");
    expect(h).toMatch(/^[0-9a-f]{7}$/);
  });

  it("is deterministic", () => {
    const a = fnv1a7("hello:world:42:1:message");
    const b = fnv1a7("hello:world:42:1:message");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = fnv1a7("rule-a:file.ts:1:1:msg");
    const b = fnv1a7("rule-b:file.ts:1:1:msg");
    expect(a).not.toBe(b);
  });
});
