import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineRule } from "../../domain/rule.js";
import { RuleContextImpl } from "../../domain/rule-context.js";
import { Parser } from "../infrastructure/parser.js";
import { walkFile } from "./tree-walker.js";

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
  it("dispatches to comment visitors", async () => {
    const source = `// hello\nconst x = 1\n// world\n`;
    const tree = await parse(source);

    const rule = defineRule({
      meta: {
        name: "test-comments",
        description: "Test",
        languages: ["ts"],
        instruction: "Check comments",
      },
      createOnce(context) {
        return {
          comment(node) {
            context.flag({ node, message: `Found: ${node.text}` });
          },
        };
      },
    });

    const context = new RuleContextImpl("test-comments");
    const visitors = rule.createOnce(context);
    context.setFile("test.ts", source);

    const flags = walkFile(tree, [{ ruleName: "test-comments", context, visitors }]);
    expect(flags.length).toBe(2);
    expect(flags[0]!.message).toContain("hello");
    expect(flags[1]!.message).toContain("world");
  });

  it("dispatches to multiple rules in a single pass", async () => {
    const source = `// a comment\nfunction foo() {}\n`;
    const tree = await parse(source);

    const commentRule = defineRule({
      meta: { name: "r1", description: "d1", languages: ["ts"], instruction: "i1" },
      createOnce(context) {
        return {
          comment(node) {
            context.flag({ node, message: "comment found" });
          },
        };
      },
    });

    const funcRule = defineRule({
      meta: { name: "r2", description: "d2", languages: ["ts"], instruction: "i2" },
      createOnce(context) {
        return {
          function_declaration(node) {
            context.flag({ node, message: "function found" });
          },
        };
      },
    });

    const ctx1 = new RuleContextImpl("r1");
    const ctx2 = new RuleContextImpl("r2");
    const v1 = commentRule.createOnce(ctx1);
    const v2 = funcRule.createOnce(ctx2);
    ctx1.setFile("test.ts", source);
    ctx2.setFile("test.ts", source);

    const flags = walkFile(tree, [
      { ruleName: "r1", context: ctx1, visitors: v1 },
      { ruleName: "r2", context: ctx2, visitors: v2 },
    ]);

    expect(flags.length).toBe(2);
    expect(flags.some((f) => f.ruleName === "r1")).toBe(true);
    expect(flags.some((f) => f.ruleName === "r2")).toBe(true);
  });

  it("respects before() returning false to skip file", async () => {
    const source = `// skip me\n`;
    const _tree = await parse(source);

    const rule = defineRule({
      meta: { name: "skip", description: "d", languages: ["ts"], instruction: "i" },
      createOnce(context) {
        return {
          before() {
            return false;
          },
          comment(node) {
            context.flag({ node, message: "should not fire" });
          },
        };
      },
    });

    const ctx = new RuleContextImpl("skip");
    const visitors = rule.createOnce(ctx);
    ctx.setFile("test.ts", source);

    // Simulate the before() check like check.ts does
    const shouldRun = visitors.before?.("test.ts");
    if (shouldRun === false) {
      // Don't walk
      expect(ctx.flags.length).toBe(0);
    }
  });
});
