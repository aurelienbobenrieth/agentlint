import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { rulesListHandler, rulesScanHandler, rulesTestHandler } from "./handler.js";
import { RulesListCommand, RulesScanCommand, RulesTestCommand } from "./request.js";

const cwd = mkdtempSync(join(tmpdir(), "agentlint-rules-"));
mkdirSync(join(cwd, "src"));
writeFileSync(join(cwd, "src", "demo.ts"), 'danger("x")');
const rule = featureTestRule();
const layer = featureTestLayer({ cwd, rules: [rule] });

afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe("rule handlers", () => {
  it("lists sorted rule metadata and evaluates normalized file scopes", async () => {
    const enabled = await Effect.runPromise(
      rulesListHandler(new RulesListCommand({ file: "src\\demo.ts" })).pipe(Effect.provide(layer)),
    );
    const disabled = await Effect.runPromise(
      rulesListHandler(new RulesListCommand({ file: "test\\demo.ts" })).pipe(Effect.provide(layer)),
    );

    expect(enabled.rules).toEqual([
      expect.objectContaining({ id: "security/danger", detector: "typescript/danger-call@1", enabled: true }),
    ]);
    expect(disabled.rules[0]?.enabled).toBe(false);
  });

  it("distinguishes unknown rules from rules without fixtures", async () => {
    const missing = await Effect.runPromise(
      rulesTestHandler(new RulesTestCommand({ rules: ["missing"] })).pipe(Effect.provide(layer)),
    );
    const fixtureless = await Effect.runPromise(
      rulesTestHandler(new RulesTestCommand({ rules: [rule.binding.id] })).pipe(Effect.provide(layer)),
    );

    expect(missing).toMatchObject({ exitCode: 2 });
    expect(missing.message).toContain("Available: security/danger");
    expect(fixtureless).toMatchObject({ exitCode: 0 });
    expect(fixtureless.message).toContain("without fixtures");
  });

  it("scans selected rules after fixture validation", async () => {
    const result = await Effect.runPromise(
      rulesScanHandler(
        new RulesScanCommand({ rules: [rule.binding.id], base: undefined, files: ["src/demo.ts"] }),
      ).pipe(Effect.provide(layer)),
    );

    expect(result.exitCode).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe(rule.binding.id);
  });
});
