import { describe, expect, it } from "vitest";
import { defineRule } from "../../domain/rule.js";
import { testRuleFixtures, testRuleOnChange } from "../../testing.js";
import { normalizeChangeFixture } from "./rule-tester.js";

const standard = {
  id: "database/safe-change",
  revision: 1,
  title: "Make safe database changes",
  guidance: "Review database operations that can remove data.",
} as const;

describe("rule fixtures", () => {
  it("checks state mustReport and mustStaySilent fixtures", async () => {
    const rule = defineRule({
      lifecycle: "state",
      standard,
      detector: {
        id: "javascript/eval",
        version: 1,
        match: { pattern: "eval($$$ARGS)", message: "Review dynamic evaluation." },
        fixtures: {
          mustReport: [{ label: "dynamic evaluation", file: "example.ts", source: "eval(input)" }],
          mustStaySilent: [{ files: { "one.ts": "JSON.parse(input)", "two.ts": "const evalResult = input" } }],
        },
      },
      binding: { id: "security/no-eval", authority: "agent" },
    });

    await expect(testRuleFixtures(rule)).resolves.toEqual({ ruleId: "security/no-eval", total: 2, failures: [] });
  });

  it("normalizes before-and-after repositories", () => {
    const change = normalizeChangeFixture({
      before: { "changed.txt": "old", "deleted.txt": "gone" },
      after: { "changed.txt": "new", "added.txt": "hello" },
    });
    expect(change.files.map(({ path, status }) => [path, status])).toEqual([
      ["added.txt", "added"],
      ["changed.txt", "modified"],
      ["deleted.txt", "deleted"],
    ]);
    expect(change.files[0]?.hunks[0]?.oldStart).toBe(0);
    expect(change.files[2]?.hunks[0]?.newStart).toBe(0);
    expect(change.files[0]?.after?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("checks change fixtures and reports stable evidence", async () => {
    const rule = defineRule({
      lifecycle: "change",
      standard,
      detector: {
        id: "sql/drop-column",
        version: 1,
        detect(context) {
          for (const file of context.change.files) {
            if (file.after?.content?.includes("DROP COLUMN")) {
              context.report({
                key: `${file.path}:drop-column`,
                file: file.path,
                message: "Review data removal.",
                evidence: { operation: "drop-column" },
              });
            }
          }
        },
        fixtures: {
          mustReport: [{ after: { "migration.sql": "ALTER TABLE users DROP COLUMN email;" } }],
          mustStaySilent: [{ after: { "migration.sql": "ALTER TABLE users ADD COLUMN email text;" } }],
        },
      },
      binding: { id: "database/drop-column", authority: "human" },
    });

    const report = await testRuleFixtures(rule);
    expect(report.failures).toEqual([]);
    const fixture = rule.detector.fixtures?.mustReport?.[0];
    if (!fixture) throw new Error("Expected a mustReport fixture");
    const findings = await testRuleOnChange(rule, fixture);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding).toMatchObject({
      ruleId: "database/drop-column",
      lifecycle: "change",
      authority: "human",
      file: "migration.sql",
      absolutePath: "migration.sql",
      message: "Review data removal.",
      sourceSnippet: "ALTER TABLE users DROP COLUMN email;",
    });
    expect(finding?.source.detectorId).toBe("sql/drop-column");
    const again = await testRuleOnChange(rule, fixture);
    expect(again[0]?.fingerprint).toEqual(finding?.fingerprint);
  });
});
