import { describe, expect, it } from "vitest";
import { defineRule, type RuleMatch } from "../../domain/rule.js";
import { testRuleFixtures, testRuleOnSource } from "../../testing.js";

const patternRule = (match: RuleMatch) =>
  defineRule({
    lifecycle: "state",
    standard: { id: "test/standard", revision: 1, title: "Test standard", guidance: "Test standard." },
    detector: { id: "typescript/test-trigger", version: 1, match },
    binding: { id: "test/pattern", authority: "agent" },
  });

describe("structural pattern matching", () => {
  it("matches code shape but not text or wrapper calls", async () => {
    const rule = patternRule({ pattern: "useQuery($$$ARGS)", message: "query" });
    const findings = await testRuleOnSource(
      rule,
      "const text = 'useQuery(x)'; const actual = wrap(useQuery({ queryKey: ['x'] }));",
      "fixture.tsx",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sourceSnippet).toContain("useQuery");
  });

  it("interpolates captures", async () => {
    const rule = patternRule({ pattern: "$DB.findMany($$$ARGS)", message: "unbounded $DB" });
    const findings = await testRuleOnSource(rule, "db.users.findMany({})", "fixture.ts");
    expect(findings[0]?.message).toBe("unbounded db.users");
  });

  it("applies structural subtree constraints", async () => {
    const rule = patternRule({
      pattern: "fetch($$$ARGS)",
      where: { notHas: "signal" },
      message: "missing signal",
    });
    const findings = await testRuleOnSource(
      rule,
      "fetch('/a'); fetch('/b', { signal }); fetch('/c', { signal: AbortSignal.timeout(5) });",
      "fixture.ts",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.sourceSnippet).toContain("'/a'");
  });

  it("supports raw tree-sitter queries", async () => {
    const rule = patternRule({
      query: '(call_expression function: (identifier) @fn (#eq? @fn "eval")) @match',
      message: "eval usage: @fn",
    });
    const findings = await testRuleOnSource(rule, "eval('1'); evaluate('2')", "fixture.ts");
    expect(findings.map((finding) => finding.message)).toEqual(["eval usage: eval"]);
  });

  it("fails loudly for invalid patterns and queries", async () => {
    await expect(
      testRuleOnSource(patternRule({ pattern: "useQuery(((", message: "x" }), "const x = 1"),
    ).rejects.toThrow("pattern does not parse");
    await expect(
      testRuleOnSource(patternRule({ query: "(call_expression", message: "x" }), "const x = 1"),
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
