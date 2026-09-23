import { describe, expect, it } from "vitest";
import { defineConfig } from "./config.js";
import { defineRule } from "./rule/model.js";
import { findingSourceForRule } from "./rule/identity.js";
import { testRuleOnChange, testRuleOnSource } from "../testing.js";

const standard = { id: "review", revision: 1, title: "Review", guidance: "Review." } as const;
const state = defineRule({
  lifecycle: "state",
  standard,
  detector: { id: "danger", version: 1, match: { pattern: "danger($ARG)", message: "Review this call." } },
  binding: { id: "review", authority: "agent" },
});

describe("detectors report synchronously", () => {
  it("fails a visitor that returns a promise instead of dropping its finding", async () => {
    const rule = defineRule({
      lifecycle: "state",
      standard,
      binding: { id: "async-visitor", authority: "agent" },
      detector: {
        id: "async-visitor",
        version: 1,
        createOnce: ({ context }) => ({
          call_expression: async (node) => {
            await Promise.resolve();
            context.report({ node, message: "Too late." });
          },
        }),
      },
    });
    await expect(testRuleOnSource({ rule, source: "danger(1)" })).rejects.toMatchObject({
      _tag: "agentlint/DetectionError",
      cause: { _tag: "agentlint/DetectorContractError", reason: "async_hook", detail: "call_expression" },
    });
  });

  it("fails an async change detector", async () => {
    const rule = defineRule({
      lifecycle: "change",
      standard,
      binding: { id: "async-change", authority: "human" },
      detector: {
        id: "async-change",
        version: 1,
        detect: async ({ context }) => {
          await Promise.resolve();
          context.report({ key: "k", file: "a.sql", message: "Too late.", evidence: null });
        },
      },
    });
    await expect(testRuleOnChange({ rule, fixture: { after: { "a.sql": "DROP TABLE t;" } } })).rejects.toMatchObject({
      cause: { _tag: "agentlint/DetectorContractError", reason: "async_hook", detail: "detect" },
    });
  });

  it("reports a broken change fixture as a typed rejection, not a synchronous throw", async () => {
    const rule = defineRule({
      lifecycle: "change",
      standard,
      binding: { id: "broken-change", authority: "human" },
      detector: {
        id: "broken-change",
        version: 1,
        detect: ({ context }) => {
          context.report({ key: "k", file: "a.sql", message: "One.", evidence: null });
          context.report({ key: "k", file: "a.sql", message: "Two.", evidence: null });
        },
      },
    });
    const pending = testRuleOnChange({ rule, fixture: { after: { "a.sql": "DROP TABLE t;" } } });
    await expect(pending).rejects.toMatchObject({
      _tag: "agentlint/DetectionError",
      cause: { _tag: "agentlint/DetectorContractError", reason: "duplicate_key" },
    });
  });
});

const thrown = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe("authoring functions throw only their documented errors", () => {
  it("reports every invalid rule as a RuleDefinitionError with the binding id", () => {
    const invalid = [
      { ...state, detector: { ...state.detector, match: { pattern: "x" } } },
      { ...state, detector: { ...state.detector, match: [{ pattern: "x", message: "" }] } },
      { ...state, standard: { ...standard, title: "" } },
      { ...state, binding: { ...state.binding, options: { a: undefined } } },
      { ...state, binding: { ...state.binding, dependencies: ["../outside.md"] } },
      { ...state, binding: { ...state.binding, dependencies: ["/absolute.md"] } },
    ];
    for (const rule of invalid) {
      expect(thrown(() => Reflect.apply(defineRule, undefined, [rule]))).toMatchObject({
        _tag: "agentlint/RuleDefinitionError",
        ruleId: "review",
        reason: "invalid_shape",
      });
    }
  });

  it("reports an invalid config shape as a ConfigError", () => {
    expect(thrown(() => Reflect.apply(defineConfig, undefined, [{ ignores: [1] }]))).toMatchObject({
      _tag: "agentlint/ConfigError",
      reason: "invalid_shape",
    });
  });
});

describe("binding digest", () => {
  it("keeps the digest of a binding without a review epoch", () => {
    // Pinned: a binding that never set an epoch must keep matching acceptances recorded before epochs existed.
    expect(findingSourceForRule(state).bindingDigest).toBe(
      "a189157eeecdd72ce0df647489710af951e1e84e07db64f1c21044448a622644",
    );
    expect(
      findingSourceForRule(defineRule({ ...state, binding: { ...state.binding, reviewEpoch: 1 } })).bindingDigest,
    ).not.toBe(findingSourceForRule(state).bindingDigest);
  });
});
