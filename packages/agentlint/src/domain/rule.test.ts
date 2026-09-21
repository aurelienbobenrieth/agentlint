import { describe, expect, expectTypeOf, it } from "vitest";
import { ConfigError, defineConfig, normalizeConfig } from "./config.js";
import type { ChangeRule, StateRule } from "./rule.js";
import { defineRule, RuleDefinitionError, ruleMatches } from "./rule.js";

const standard = {
  id: "data/bounded-query",
  revision: 1,
  title: "Bound database queries",
  guidance: {
    standard: "Database operations must have an explicit bound or a reviewed justification.",
    checks: ["Confirm that the result size has a safe upper limit."],
  },
} as const;

const stateRule = defineRule({
  lifecycle: "state",
  standard,
  detector: {
    id: "prisma/unbounded-query",
    version: 1,
    match: { pattern: "$DB.findMany($$$ARGS)", message: "Review this query bound." },
    fixtures: {
      mustReport: ["db.user.findMany({})"],
      mustStaySilent: ["db.user.findUnique({ where: { id } })"],
    },
  },
  binding: {
    id: "api/bounded-prisma-query",
    authority: "agent",
    include: ["apps/api/src/**/*.ts"],
    options: { clients: ["db"] as const },
  },
});

const changeRule = defineRule({
  lifecycle: "change",
  standard: {
    id: "database/safe-migration",
    revision: 2,
    title: "Roll out destructive migrations safely",
    guidance: "Destructive migrations need a reviewed rollout plan.",
  },
  detector: {
    id: "sql/drop-column",
    version: 3,
    detect(context, options) {
      for (const file of context.change.files) {
        const content = file.after?.content ?? "";
        if (options.operations.some((operation) => content.includes(operation))) {
          context.report({
            key: `${file.path}:drop-column`,
            file: file.path,
            message: "Review destructive migration.",
            evidence: { operation: "drop-column", statement: content },
          });
        }
      }
    },
    fixtures: {
      mustReport: [{ before: {}, after: { "migrations/1.sql": "ALTER TABLE users DROP COLUMN name;" } }],
      mustStaySilent: [{ before: {}, after: { "migrations/1.sql": "ALTER TABLE users ADD COLUMN name text;" } }],
    },
  },
  binding: {
    id: "database/destructive-migration",
    authority: "human",
    include: ["migrations/**/*.sql"],
    options: { operations: ["DROP COLUMN"] },
  },
});

describe("defineRule", () => {
  it("preserves state inference and structured identities", () => {
    expect(stateRule.lifecycle).toBe("state");
    expect(stateRule.binding.id).toBe("api/bounded-prisma-query");
    expect(ruleMatches(stateRule)).toHaveLength(1);
    expectTypeOf(stateRule).toMatchTypeOf<StateRule<{ readonly clients: readonly ["db"] }>>();
    expectTypeOf(stateRule.detector.match).not.toEqualTypeOf<undefined>();
  });

  it("preserves change detector option inference", () => {
    expect(changeRule.lifecycle).toBe("change");
    expect(changeRule.detector.version).toBe(3);
    expectTypeOf(changeRule).toMatchTypeOf<ChangeRule<{ readonly operations: readonly ["DROP COLUMN"] }>>();
  });

  it("supports an imperative state detector", () => {
    const rule = defineRule({
      lifecycle: "state",
      standard,
      detector: {
        id: "comments/no-noise",
        version: 1,
        createOnce(context, options: { readonly message: string }) {
          return { comment: (node) => context.report({ node, message: options.message }) };
        },
      },
      binding: { id: "comments/no-noise", authority: "agent", options: { message: "Review comment." } },
    });
    expect(rule.detector.createOnce).toBeTypeOf("function");
  });

  it("rejects invalid trigger combinations", () => {
    let caught: unknown;
    try {
      defineRule({
        lifecycle: "state",
        standard,
        detector: {
          id: "invalid/both",
          version: 1,
          match: { pattern: "eval($$$ARGS)", query: "(call_expression)", message: "Review." },
        },
        binding: { id: "invalid/both", authority: "agent" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuleDefinitionError);
    expect(caught).toMatchObject({ ruleId: "invalid/both", reason: "ambiguous_match" });
    expect(() =>
      defineRule({
        lifecycle: "state",
        standard,
        detector: {
          id: "invalid/both",
          version: 1,
          match: { pattern: "eval($$$ARGS)", query: "(call_expression)", message: "Review." },
        },
        binding: { id: "invalid/both", authority: "agent" },
      }),
    ).toThrow('exactly one of "pattern" or "query"');
  });

  it("rejects a state detector without an implementation", () => {
    expect(() =>
      defineRule({
        lifecycle: "state",
        standard,
        detector: { id: "invalid/empty", version: 1 },
        binding: { id: "invalid/empty", authority: "agent" },
      }),
    ).toThrow('must define "match" or "createOnce"');
  });

  it("rejects empty identities and invalid versions", () => {
    expect(() =>
      defineRule({
        lifecycle: "change",
        standard,
        detector: { id: "detector", version: 0, detect() {} },
        binding: { id: "binding", authority: "human" },
      }),
    ).toThrow("positive integer");
    expect(() =>
      defineRule({
        lifecycle: "change",
        standard,
        detector: { id: " ", version: 1, detect() {} },
        binding: { id: "binding", authority: "human" },
      }),
    ).toThrow("Rule binding: detector id must not be empty");
  });
});

describe("defineConfig", () => {
  it("normalizes reusable layers without hiding bindings", () => {
    const shared = defineConfig({ rules: [stateRule], ignores: ["**/generated/**"], base: "main" });
    const config = normalizeConfig(
      defineConfig({ extends: [shared], rules: [changeRule], ignores: ["**/generated/**", "**/vendor/**"] }),
    );
    expect(config.rules.map((rule) => rule.binding.id)).toEqual([
      "api/bounded-prisma-query",
      "database/destructive-migration",
    ]);
    expect(config.rulesById.get("database/destructive-migration")).toBe(changeRule);
    expect(config.ignores).toEqual(["**/generated/**", "**/vendor/**"]);
    expect(config.base).toBe("main");
  });

  it("rejects duplicate binding identities", () => {
    let caught: unknown;
    try {
      normalizeConfig(defineConfig({ rules: [stateRule, stateRule] }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught).toMatchObject({ reason: "duplicate_binding", ruleId: "api/bounded-prisma-query" });
    expect((caught as ConfigError).message).toBe("Duplicate rule binding id: api/bounded-prisma-query");
  });

  it("rejects empty base and ignore patterns", () => {
    expect(() => defineConfig({ base: " " })).toThrow("Config base must not be empty");
    expect(() => defineConfig({ ignores: [""] })).toThrow("Config ignore patterns must not be empty");
  });

  it("rejects config cycles", () => {
    const config: { extends?: Array<typeof config> } = {};
    config.extends = [config];
    expect(() => normalizeConfig(config)).toThrow("contains a cycle");
  });
});
