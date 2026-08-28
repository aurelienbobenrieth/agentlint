import { describe, expect, it } from "vitest";
import { defineRule } from "../../domain/rule.js";
import { testRuleOnSource } from "../../testing.js";

describe("state visitors", () => {
  it("dispatches only registered node types", async () => {
    const rule = defineRule({
      lifecycle: "state",
      standard: { id: "comments/review", revision: 1, title: "Review comments", guidance: "Review comments." },
      detector: {
        id: "typescript/comments",
        version: 1,
        createOnce(context) {
          return { comment: (node) => context.report({ node, message: `Found: ${node.text}` }) };
        },
      },
      binding: { id: "comments/review", authority: "agent" },
    });
    const findings = await testRuleOnSource(rule, "// hello\nconst x = 1\n// world", "fixture.ts");
    expect(findings.map((finding) => finding.message)).toEqual(["Found: // hello", "Found: // world"]);
  });

  it("allows a file hook to skip traversal", async () => {
    const rule = defineRule({
      lifecycle: "state",
      standard: { id: "comments/skip", revision: 1, title: "Skip", guidance: "Skip." },
      detector: {
        id: "typescript/skipped-comments",
        version: 1,
        createOnce(context) {
          return {
            before: () => false,
            comment: (node) => context.report({ node, message: "must not fire" }),
          };
        },
      },
      binding: { id: "comments/skip", authority: "agent" },
    });
    expect(await testRuleOnSource(rule, "// skipped", "fixture.ts")).toEqual([]);
  });
});
