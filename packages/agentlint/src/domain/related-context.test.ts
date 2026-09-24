import { expect, it } from "vitest";
import { testRuleOnChange, testRuleOnSources } from "../testing.js";
import { defineRule } from "./rule/model.js";

it("carries declared state dependencies as related reading context", async () => {
  const rule = defineRule({
    lifecycle: "state",
    standard: { id: "privacy", revision: 1, title: "Privacy", guidance: "Review the policy." },
    binding: {
      id: "privacy",
      authority: "human",
      include: ["src/**/*.ts"],
      dependencies: ["policy/privacy.md"],
    },
    detector: {
      id: "upload",
      version: 1,
      scan: "file",
      createOnce: ({ context }) => ({
        call_expression: (node) =>
          context.report({ node, message: "Review upload.", relatedFiles: ["policy/privacy.md"] }),
      }),
    },
  });
  const findings = await testRuleOnSources({
    rule,
    sources: [
      ["src/upload.ts", "upload(photo);"],
      ["policy/privacy.md", "Biometrics stay on device."],
    ],
  });
  expect(findings[0]?.relatedFiles).toEqual(["policy/privacy.md"]);
});

it("rejects undeclared state context and change context outside the selected evidence", async () => {
  const state = defineRule({
    lifecycle: "state",
    standard: { id: "review", revision: 1, title: "Review", guidance: "Review." },
    binding: { id: "review", authority: "agent" },
    detector: {
      id: "call",
      version: 1,
      scan: "file",
      createOnce: ({ context }) => ({
        call_expression: (node) => context.report({ node, message: "Review.", relatedFiles: ["other.ts"] }),
      }),
    },
  });
  await expect(testRuleOnSources({ rule: state, sources: [["src/a.ts", "run();"]] })).rejects.toThrow(
    "undeclared related context",
  );
  // Prototype keys are not declared dependencies.
  const prototypeKey = defineRule({
    ...state,
    detector: {
      ...state.detector,
      createOnce: ({ context }) => ({
        call_expression: (node) => context.report({ node, message: "Review.", relatedFiles: ["toString"] }),
      }),
    },
  });
  await expect(testRuleOnSources({ rule: prototypeKey, sources: [["src/a.ts", "run();"]] })).rejects.toThrow(
    "undeclared related context: toString",
  );

  const change = defineRule({
    lifecycle: "change",
    standard: state.standard,
    binding: { id: "change", authority: "human", include: ["**/*"] },
    detector: {
      id: "change",
      version: 1,
      detect: ({ context }) =>
        context.report({
          key: "one",
          file: "src/a.ts",
          message: "Review.",
          evidence: null,
          relatedFiles: ["src/missing.ts"],
        }),
    },
  });
  await expect(
    testRuleOnChange({ rule: change, fixture: { before: {}, after: { "src/a.ts": "run();" } } }),
  ).rejects.toMatchObject({
    _tag: "agentlint/DetectionError",
    cause: { _tag: "agentlint/DetectorContractError", reason: "outside_change_set", detail: "src/missing.ts" },
  });
});
