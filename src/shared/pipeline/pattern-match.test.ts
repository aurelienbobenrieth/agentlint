import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineRule } from "../../domain/rule.js";
import { Parser } from "../infrastructure/parser.js";
import { runRuleFixtures, runRuleOnSource } from "./rule-tester.js";

const ParserLayer = Parser.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(Env.layer));

function run<A, E>(effect: Effect.Effect<A, E, Parser>) {
  return Effect.runPromise(effect.pipe(Effect.provide(ParserLayer)));
}

const patternRule = (pattern: string, message = "matched", where?: { has?: string; notHas?: string }) =>
  defineRule({
    id: "test/pattern",
    description: "test rule",
    guidance: "Test standard.",
    match: [{ pattern, message, ...(where ? { where } : {}) }],
  });

describe("pattern matching", () => {
  it("matches a call by callee name only", async () => {
    const rule = patternRule("useQuery($$$ARGS)");
    const findings = await run(
      runRuleOnSource(rule, "const a = useQuery({ queryKey: ['x'] }); const b = useOther({});", "fixture.tsx"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.nodeType).toBe("call_expression");
  });

  it("does not fire on wrapper calls around a matching inner call", async () => {
    const rule = patternRule("useQuery($$$ARGS)");
    const findings = await run(
      runRuleOnSource(rule, "const memo = useMemo(() => useQuery({ queryKey: ['x'] }), []);", "fixture.tsx"),
    );
    // Only the inner useQuery call fires, not the useMemo wrapper.
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sourceSnippet).toContain("useQuery");
  });

  it("does not match identifiers inside strings or comments", async () => {
    const rule = patternRule("useQuery($$$ARGS)");
    const findings = await run(
      runRuleOnSource(rule, "const s = 'useQuery(x)'; // useQuery(y)\nconst t = other();", "fixture.tsx"),
    );
    expect(findings).toHaveLength(0);
  });

  it("captures single metavariables and interpolates them into messages", async () => {
    const rule = patternRule("$OBJ.findMany($$$ARGS)", "unbounded findMany on $OBJ");
    const findings = await run(runRuleOnSource(rule, "await db.users.findMany({});", "fixture.ts"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe("unbounded findMany on db.users");
  });

  it("matches exact argument shapes without metavariables", async () => {
    const rule = patternRule("fetchAll()");
    const findings = await run(runRuleOnSource(rule, "fetchAll(); fetchAll(1);", "fixture.ts"));
    expect(findings).toHaveLength(1);
  });

  it("supports where.notHas constraints against the matched subtree", async () => {
    const rule = patternRule("useQuery($$$ARGS)", "unbounded", { notHas: "limit: $_" });
    const findings = await run(
      runRuleOnSource(rule, "useQuery({ queryKey: ['a'] }); useQuery({ queryKey: ['b'], limit: 10 });", "fixture.tsx"),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sourceSnippet).toContain("'a'");
  });

  it("supports where.has constraints", async () => {
    const rule = patternRule("it($$$ARGS)", "focused test", { has: "only" });
    const findings = await run(runRuleOnSource(rule, "it('a', () => {}); it.skip('b', () => {});", "fixture.ts"));
    expect(findings).toHaveLength(0);
  });

  it("supports raw tree-sitter queries with @match capture", async () => {
    const rule = defineRule({
      id: "test/query",
      description: "query rule",
      guidance: "Test standard.",
      match: [
        {
          query: '(call_expression function: (identifier) @fn (#eq? @fn "eval")) @match',
          message: "eval usage: @fn",
        },
      ],
    });
    const findings = await run(runRuleOnSource(rule, "eval('1 + 1'); other('x');", "fixture.ts"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe("eval usage: eval");
  });

  it("fails loudly when a pattern does not parse", async () => {
    const rule = patternRule("useQuery(((");
    await expect(run(runRuleOnSource(rule, "const x = 1;", "fixture.ts"))).rejects.toThrow("pattern does not parse");
  });

  it("fails loudly when a query is malformed", async () => {
    const rule = defineRule({
      id: "test/bad-query",
      description: "bad query",
      guidance: "Test standard.",
      match: [{ query: "(call_expression", message: "x" }],
    });
    await expect(run(runRuleOnSource(rule, "const x = 1;", "fixture.ts"))).rejects.toThrow("invalid tree-sitter query");
  });
});

describe("rule fixtures", () => {
  it("reports failing invalid fixtures", async () => {
    const rule = defineRule({
      id: "test/fixtures",
      description: "fixture rule",
      guidance: "Test standard.",
      match: [{ pattern: "useQuery($$$ARGS)", message: "m" }],
      fixtures: {
        invalid: ["useQuery({})", "notMatching()"],
        valid: ["other()"],
      },
    });
    const report = await run(runRuleFixtures(rule));
    expect(report.total).toBe(3);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({ kind: "invalid", index: 1 });
  });

  it("passes when all fixtures hold", async () => {
    const report = await run(
      runRuleFixtures(
        defineRule({
          id: "test/ok",
          description: "ok",
          guidance: "Test standard.",
          match: [{ pattern: "eval($$$A)", message: "m" }],
          fixtures: { invalid: ["eval('x')"], valid: ["evaluate('x')"] },
        }),
      ),
    );
    expect(report.failures).toHaveLength(0);
  });
});

describe("defineRule validation", () => {
  it("rejects rules with neither match nor createOnce", () => {
    expect(() => defineRule({ id: "x/y", description: "d", guidance: "g" })).toThrow(
      'must define "match" or "createOnce"',
    );
  });

  it("rejects matches with both pattern and query", () => {
    expect(() =>
      defineRule({
        id: "x/y",
        description: "d",
        guidance: "g",
        match: [{ pattern: "a()", query: "(program)", message: "m" }],
      }),
    ).toThrow('exactly one of "pattern" or "query"');
  });
});
