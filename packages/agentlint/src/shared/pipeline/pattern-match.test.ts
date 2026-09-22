import { Array as EffectArray, Order } from "effect";
import { describe, expect, it } from "vitest";
import { defineRule, type RuleMatch } from "../../domain/rule/model.js";
import { testRuleFixtures, testRuleOnSource, testRuleOnSources } from "../../testing.js";

const patternRule = (match: RuleMatch | ReadonlyArray<RuleMatch>) =>
  defineRule({
    lifecycle: "state",
    standard: { id: "test/standard", revision: 1, title: "Test standard", guidance: "Test standard." },
    detector: { id: "typescript/test-trigger", version: 1, match },
    binding: { id: "test/pattern", authority: "agent" },
  });

describe("structural pattern matching", () => {
  it("matches code shape but not text or wrapper calls", async () => {
    const rule = patternRule({ pattern: "useQuery($$$ARGS)", message: "query" });
    const findings = await testRuleOnSource({
      rule,
      source: "const text = 'useQuery(x)'; const actual = wrap(useQuery({ queryKey: ['x'] }));",
      file: "fixture.tsx",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sourceSnippet).toContain("useQuery");
  });

  it("interpolates captures", async () => {
    const rule = patternRule({ pattern: "$DB.findMany($$$ARGS)", message: "unbounded $DB" });
    const findings = await testRuleOnSource({ rule, source: "db.users.findMany({})", file: "fixture.ts" });
    expect(findings[0]?.message).toBe("unbounded db.users");
  });

  it("applies structural subtree constraints", async () => {
    const rule = patternRule({
      pattern: "fetch($$$ARGS)",
      where: { notHas: "signal" },
      message: "missing signal",
    });
    const findings = await testRuleOnSource({
      rule,
      source: "fetch('/a'); fetch('/b', { signal }); fetch('/c', { signal: AbortSignal.timeout(5) });",
      file: "fixture.ts",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sourceSnippet).toContain("'/a'");
  });

  it("supports raw tree-sitter queries", async () => {
    const rule = patternRule({
      query: '(call_expression function: (identifier) @fn (#eq? @fn "eval")) @match',
      message: "eval usage: @fn",
    });
    const findings = await testRuleOnSource({ rule, source: "eval('1'); evaluate('2')", file: "fixture.ts" });
    expect(findings.map((finding) => finding.message)).toEqual(["eval usage: eval"]);
  });

  it("fails loudly for invalid patterns and queries", async () => {
    await expect(
      testRuleOnSource({ rule: patternRule({ pattern: "useQuery(((", message: "x" }), source: "const x = 1" }),
    ).rejects.toThrow("pattern does not parse");
    await expect(
      testRuleOnSource({ rule: patternRule({ query: "(call_expression", message: "x" }), source: "const x = 1" }),
    ).rejects.toThrow("invalid tree-sitter query");
  });

  it("reports fixture activation and silence regressions", async () => {
    const rule = defineRule({
      ...patternRule({ pattern: "useQuery($$$ARGS)", message: "query" }),
      detector: {
        id: "typescript/test-trigger",
        version: 1,
        match: { pattern: "useQuery($$$ARGS)", message: "query" },
        fixtures: { mustReport: ["useQuery({})", "other()"], mustStaySilent: ["evaluate()"] },
      },
    });
    const report = await testRuleFixtures(rule);
    expect(report.total).toBe(3);
    expect(report.failures).toMatchObject([{ expectation: "mustReport", index: 1 }]);
  });
});

describe("deep and long code", () => {
  it("matches a 3000-term binary expression without exhausting the stack", { timeout: 45_000 }, async () => {
    const sum = Array.from({ length: 3000 }, () => "'a'").join(" + ");
    const source = `const s = ${sum};
danger(s);
same([${sum}, ${sum}]);`;
    const run = (match: RuleMatch) => testRuleOnSource({ rule: patternRule(match), source, file: "deep.ts" });

    const calls = await run({ pattern: "danger($A)", where: { notHas: "missing" }, message: "danger" });
    expect(calls.map((finding) => finding.line)).toEqual([2]);

    const constrained = await run({
      pattern: "const s = $A",
      where: { has: "'a'", notHas: "missing" },
      message: "sum",
    });
    expect(constrained).toHaveLength(1);

    const sums = await run({ pattern: "$A + $B", message: "sum" });
    expect(sums).toHaveLength(2999 * 3);
    expect(new Set(sums.map((finding) => finding.fingerprint.digest)).size).toBe(sums.length);

    expect(await run({ pattern: "[$A, $A]", message: "same" })).toHaveLength(1);
  });

  it("handles a 400-link call chain with a constraint", async () => {
    const source = `x${".f()".repeat(400)};`;
    const rule = patternRule({ pattern: "$F($$$ARGS)", where: { notHas: "missing" }, message: "call" });
    await testRuleOnSource({ rule, source: "warm.up()", file: "chain.ts" });
    const findings = await testRuleOnSource({ rule, source, file: "chain.ts" });
    expect(findings).toHaveLength(400);
  });
});

describe("bindings that cover several languages", () => {
  const evalRule = patternRule({ pattern: "eval($$$ARGS)", where: { notHas: "safe" }, message: "eval" });

  it("applies a pattern only to the files whose grammar can read it", async () => {
    const findings = await testRuleOnSources({
      rule: evalRule,
      sources: [
        ["package.json", '{ "name": "x" }'],
        ["src/run.ts", "eval(input as string)"],
        ["legacy.js", "eval(input)"],
      ],
    });
    expect(
      EffectArray.sortWith(
        findings.map((finding) => finding.file),
        (value) => value,
        Order.String,
      ),
    ).toEqual(["legacy.js", "src/run.ts"]);

    const typed = patternRule({ pattern: "$A as unknown as $T", message: "double cast" });
    const casts = await testRuleOnSources({
      rule: typed,
      sources: [
        ["legacy.js", "run(input)"],
        ["src/run.ts", "run(input as unknown as Request)"],
      ],
    });
    expect(casts.map((finding) => finding.file)).toEqual(["src/run.ts"]);
  });

  it("applies each match of a rule where it compiles", async () => {
    const mixed = patternRule([
      { pattern: '{ "private": false }', message: "public package" },
      { query: "(call_expression function: (identifier) @fn) @match", message: "call @fn" },
    ]);
    const findings = await testRuleOnSources({
      rule: mixed,
      sources: [
        ["package.json", '{ "private": false }'],
        ["src/run.ts", "run()"],
      ],
    });
    expect(
      EffectArray.sortWith(
        findings.map((finding) => `${finding.file}: ${finding.message}`),
        (value) => value,
        Order.String,
      ),
    ).toEqual(["package.json: public package", "src/run.ts: call run"]);
  });

  it("still fails when no grammar in scope can read the pattern", async () => {
    await expect(
      testRuleOnSources({
        rule: evalRule,
        sources: [
          ["package.json", "{}"],
          ["tsconfig.json", "{}"],
        ],
      }),
    ).rejects.toThrow("pattern does not parse as json");
    await expect(
      testRuleOnSources({
        rule: patternRule({ pattern: "eval(((", message: "x" }),
        sources: [
          ["package.json", "{}"],
          ["src/run.ts", "run()"],
        ],
      }),
    ).rejects.toThrow("pattern does not parse");
  });
});
