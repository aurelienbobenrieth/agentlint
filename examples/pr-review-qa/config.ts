import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

// Disposable PR fixture. This configuration is not intended to be merged.
export default defineConfig({
  rules: [
    defineRule({
      lifecycle: "state",
      standard: {
        id: "qa/dynamic-code",
        revision: 1,
        title: "Dynamic code execution needs a reviewed trust boundary",
        guidance: {
          standard: "Runtime expressions need an explicit trust boundary reviewed by a human.",
          checks: [
            "Is this fixture imported or executed by production code?",
            "For production use, replace eval with a constrained expression interpreter.",
          ],
        },
      },
      detector: {
        id: "qa/eval-call",
        version: 1,
        match: { pattern: "eval($_)", message: "A runtime expression reaches eval." },
        fixtures: {
          mustReport: [{ file: "fixture.js", source: "eval(expression)" }],
          mustStaySilent: [{ file: "fixture.js", source: "formulaEngine.evaluate(expression)" }],
        },
      },
      binding: { id: "qa/dynamic-code", authority: "human", include: ["examples/pr-review-qa/*.js"] },
    }),
  ],
});
