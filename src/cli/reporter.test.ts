import { Effect, HashMap, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Env } from "../config/env.js";
import { FlagRecord } from "../domain/flag.js";
import type { RuleMeta } from "../domain/rule.js";
import { formatReport } from "./reporter.js";

const VERSION = "0.1.0";

function makeFlag(overrides: Partial<FlagRecord> = {}): FlagRecord {
  return new FlagRecord({
    ruleName: "test-rule",
    filename: process.cwd() + "/src/foo.ts",
    line: 10,
    col: 1,
    message: "Something found",
    sourceSnippet: "const x = badThing()",
    hash: "abc1234",
    instruction: undefined,
    suggest: undefined,
    ...overrides,
  });
}

const testMeta: RuleMeta = {
  name: "test-rule",
  description: "A test rule",
  languages: ["ts"],
  instruction: "Evaluate this carefully.\nCheck if it matters.",
};

const runReport = (
  flags: ReadonlyArray<FlagRecord>,
  metas: HashMap.HashMap<string, RuleMeta>,
  options: { dryRun: boolean; version: string },
) => {
  const TestLayer = Layer.mergeAll(NodeServices.layer, Env.layer);
  return Effect.runPromise(formatReport(flags, metas, options).pipe(Effect.provide(TestLayer)));
};

describe("formatReport", () => {
  it("shows clean output for zero flags", async () => {
    const result = await runReport([], HashMap.empty(), { dryRun: false, version: VERSION });
    expect(result).toContain("no rules triggered");
  });

  it("groups flags by rule", async () => {
    const flags = [
      makeFlag({ ruleName: "rule-a", hash: "aaaa111" }),
      makeFlag({ ruleName: "rule-b", hash: "bbbb222" }),
      makeFlag({ ruleName: "rule-a", hash: "aaaa333" }),
    ];
    const metas: HashMap.HashMap<string, RuleMeta> = HashMap.make(
      ["rule-a", { ...testMeta, name: "rule-a", description: "Rule A" }],
      ["rule-b", { ...testMeta, name: "rule-b", description: "Rule B" }],
    );

    const result = await runReport(flags, metas, { dryRun: false, version: VERSION });
    expect(result).toContain("rule-a");
    expect(result).toContain("rule-b");
    expect(result).toContain("3 matches");
  });

  it("includes instruction block", async () => {
    const flags = [makeFlag()];
    const metas = HashMap.make(["test-rule", testMeta]);

    const result = await runReport(flags, metas, { dryRun: false, version: VERSION });
    expect(result).toContain("Instruction");
    expect(result).toContain("Evaluate this carefully.");
  });

  it("omits instruction block in dry-run mode", async () => {
    const flags = [makeFlag()];
    const metas = HashMap.make(["test-rule", testMeta]);

    const result = await runReport(flags, metas, { dryRun: true, version: VERSION });
    expect(result).not.toContain("Instruction");
  });

  it("shows per-match notes for overrides", async () => {
    const flags = [
      makeFlag({ instruction: "Special handling needed", hash: "spec111" }),
      makeFlag({ suggest: "Try renaming", hash: "sugg222" }),
    ];
    const metas = HashMap.make(["test-rule", testMeta]);

    const result = await runReport(flags, metas, { dryRun: false, version: VERSION });
    expect(result).toContain("Special handling needed");
    expect(result).toContain("Try renaming");
  });

  it("shows large output warning", async () => {
    const flags = Array.from({ length: 60 }, (_, i) => makeFlag({ hash: `h${String(i).padStart(6, "0")}` }));
    const metas = HashMap.make(["test-rule", testMeta]);

    const result = await runReport(flags, metas, { dryRun: false, version: VERSION });
    expect(result).toContain("⚠");
    expect(result).toContain("Consider narrowing scope");
  });

  it("uses relative file paths", async () => {
    const flags = [makeFlag()];
    const metas = HashMap.make(["test-rule", testMeta]);

    const result = await runReport(flags, metas, { dryRun: false, version: VERSION });
    expect(result).toContain("src/foo.ts:10:1");
    expect(result).not.toContain(process.cwd());
  });
});
