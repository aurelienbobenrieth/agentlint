import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineRule } from "../../domain/rule.js";
import { RuleContextImpl } from "../../domain/rule-context.js";
import { Parser } from "../infrastructure/parser.js";
import { visitorKeys, walkFile } from "./tree-walker.js";

const ParserLayer = Parser.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(Env.layer));

function parse(source: string, grammar = "typescript") {
  return Effect.runPromise(
    Effect.gen(function* () {
      const parser = yield* Parser;
      return yield* parser.parse(source, grammar);
    }).pipe(Effect.provide(ParserLayer)),
  );
}

describe("TreeWalker", () => {
  it("dispatches only to registered visitor keys", async () => {
    const source = `// hello\nconst x = 1\n// world\n`;
    const tree = await parse(source);

    const rule = defineRule({
      id: "test/comments",
      description: "Test comments",
      guidance: "Comments should be evaluated.",
      createOnce(context) {
        return {
          comment(node) {
            context.report({ node, message: `Found: ${node.text}` });
          },
        };
      },
    });

    const context = new RuleContextImpl("test/comments");
    const visitors = rule.createOnce(context);
    context.setFile("test.ts", "test.ts", source);

    const findings = walkFile(tree, [{ ruleId: "test/comments", context, visitors }]);
    expect(visitorKeys(visitors)).toEqual(["comment"]);
    expect(findings).toHaveLength(2);
    expect(findings[0]!.message).toContain("hello");
    expect(findings[1]!.message).toContain("world");
  });

  it("dispatches multiple rules in a single pass", async () => {
    const source = `// a comment\nfunction foo() {}\n`;
    const tree = await parse(source);

    const commentRule = defineRule({
      id: "r/comment",
      description: "d1",
      guidance: "i1",
      createOnce(context) {
        return {
          comment(node) {
            context.report({ node, message: "comment found" });
          },
        };
      },
    });

    const functionRule = defineRule({
      id: "r/function",
      description: "d2",
      guidance: "i2",
      createOnce(context) {
        return {
          function_declaration(node) {
            context.report({ node, message: "function found" });
          },
        };
      },
    });

    const ctx1 = new RuleContextImpl("r/comment");
    const ctx2 = new RuleContextImpl("r/function");
    const v1 = commentRule.createOnce(ctx1);
    const v2 = functionRule.createOnce(ctx2);
    ctx1.setFile("test.ts", "test.ts", source);
    ctx2.setFile("test.ts", "test.ts", source);

    const findings = walkFile(tree, [
      { ruleId: "r/comment", context: ctx1, visitors: v1 },
      { ruleId: "r/function", context: ctx2, visitors: v2 },
    ]);

    expect(findings).toHaveLength(2);
    expect(findings.some((finding) => finding.ruleId === "r/comment")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "r/function")).toBe(true);
  });

  it("supports before returning false before traversal", async () => {
    const source = `// skip me\n`;
    await parse(source);

    const context = new RuleContextImpl("skip/file");
    let beforeCalls = 0;
    const visitors = {
      before() {
        beforeCalls++;
        return false;
      },
      comment(node) {
        context.report({ node, message: "should not fire" });
      },
    };
    context.setFile("test.ts", "test.ts", source);

    const shouldRun = visitors.before("test.ts");
    expect(shouldRun).toBe(false);
    expect(beforeCalls).toBe(1);
    expect(context.findings).toHaveLength(0);
  });
});
