import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { featureTestLayer, featureTestRule } from "../../__fixtures__/feature-test-services.js";
import { explainHandler } from "./handler.js";
import { ExplainCommand } from "./request.js";

const cwd = mkdtempSync(join(tmpdir(), "agentlint-explain-"));
const rule = featureTestRule();
const layer = featureTestLayer({ cwd, rules: [rule] });

afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe("explainHandler", () => {
  it("explains a rule directly without requiring a finding", async () => {
    const result = await Effect.runPromise(
      explainHandler(new ExplainCommand({ selector: rule.binding.id })).pipe(Effect.provide(layer)),
    );

    expect(result.found).toBe(true);
    expect(result.output).toContain("# danger is reviewed");
    expect(result.output).toContain("Rule: security/danger");
    expect(result.output).toContain("Detector: typescript/danger-call@1");
    expect(result.output).toContain("Include: src/**/*.ts");
  });

  it("reports an unknown selector deterministically", async () => {
    const result = await Effect.runPromise(
      explainHandler(new ExplainCommand({ selector: "missing" })).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({ found: false });
    expect(result.output).toContain('No current finding matches "missing"');
  });
});
