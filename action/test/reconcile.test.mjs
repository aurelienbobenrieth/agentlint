// @ts-check
import { describe, expect, it } from "vitest";

import { planReconciliation } from "../src/reconcile.mjs";

/** @typedef {import("../src/artifact.mjs").Finding} Finding */
/** @typedef {import("../src/reconcile.mjs").Thread} Thread */

/**
 * @param {Partial<Finding> & { digest: string }} overrides
 * @returns {Finding}
 */
function finding(overrides) {
  return {
    id: overrides.digest,
    ruleId: "rule",
    ruleTitle: "Rule",
    lifecycle: "state",
    authority: "human",
    file: "src/a.ts",
    line: 3,
    column: 1,
    message: "m",
    guidance: { standard: "s", checks: [] },
    status: "unresolved",
    acceptance: null,
    lineageReason: null,
    proposal: null,
    ...overrides,
  };
}

/** @param {Partial<Thread> & { digest: string }} overrides @returns {Thread} */
function thread(overrides) {
  return { commentId: 1, resolved: false, threadId: "T_1", ...overrides };
}

const commentable = new Map([["src/a.ts", new Set([1, 2, 3])]]);

describe("planReconciliation", () => {
  it("creates inline comments for commentable findings without a thread", () => {
    const plan = planReconciliation({ findings: [finding({ digest: "a".repeat(64) })], threads: [], commentable });
    expect(plan.create.map((f) => f.digest)).toEqual(["a".repeat(64)]);
    expect(plan.outside).toEqual([]);
  });

  it("lists findings outside the diff instead of creating comments", () => {
    const outside = finding({ digest: "b".repeat(64), line: 40 });
    const otherFile = finding({ digest: "c".repeat(64), file: "src/z.ts" });
    const plan = planReconciliation({ findings: [outside, otherFile], threads: [], commentable });
    expect(plan.create).toEqual([]);
    expect(plan.outside).toEqual([outside, otherFile]);
  });

  it("leaves threads whose finding is still unresolved", () => {
    const digest = "d".repeat(64);
    const plan = planReconciliation({ findings: [finding({ digest })], threads: [thread({ digest })], commentable });
    expect(plan.create).toEqual([]);
    expect(plan.leave).toHaveLength(1);
    expect(plan.resolve).toEqual([]);
  });

  it("resolves threads whose finding disappeared", () => {
    const plan = planReconciliation({ findings: [], threads: [thread({ digest: "e".repeat(64) })], commentable });
    expect(plan.resolve).toHaveLength(1);
    expect(plan.resolve[0]?.reply).toBe("Resolved: the finding no longer exists");
  });

  it("resolves threads whose finding was accepted, with actor and reason", () => {
    const digest = "f".repeat(64);
    const accepted = finding({
      digest,
      status: "accepted",
      acceptance: { actor: "human:aurel", reason: "bounded by TTL", at: "2026-08-29T00:00:00Z" },
    });
    const plan = planReconciliation({ findings: [accepted], threads: [thread({ digest })], commentable });
    expect(plan.resolve[0]?.reply).toBe("Resolved: accepted by human:aurel — bounded by TTL");
    expect(plan.create).toEqual([]);
  });

  it("never touches a thread that is already resolved", () => {
    const plan = planReconciliation({
      findings: [],
      threads: [thread({ digest: "0".repeat(64), resolved: true })],
      commentable,
    });
    expect(plan.resolve).toEqual([]);
    expect(plan.leave).toHaveLength(1);
  });

  it("does not create a second comment when a resolved thread exists for a finding that came back", () => {
    const digest = "1".repeat(64);
    const plan = planReconciliation({
      findings: [finding({ digest })],
      threads: [thread({ digest, resolved: true })],
      commentable,
    });
    expect(plan.create).toEqual([]);
    expect(plan.leave).toHaveLength(1);
  });
});
