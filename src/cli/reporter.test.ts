import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Env } from "../config/env.js";
import { defineConfig, defineRule, normalizeConfig } from "../index.js";
import { FindingRecord } from "../domain/finding.js";
import { formatCheckJsonl, formatCheckText } from "./reporter.js";

const rule = defineRule({
  id: "comments/no-noise",
  description: "Flags comments.",
  guidance: {
    standard: "Comments should add durable context.",
    checks: ["Do not restate code."],
  },
  createOnce() {
    return {};
  },
});

const config = normalizeConfig(
  defineConfig({
    rules: { "comments/no-noise": rule },
  }),
);

const finding = new FindingRecord({
  selector: "1",
  ruleId: "comments/no-noise",
  file: "src/foo.ts",
  absolutePath: `${process.cwd()}/src/foo.ts`,
  nodeType: "comment",
  line: 10,
  column: 1,
  message: "Comment should be evaluated.",
  sourceSnippet: "// TODO",
  hash: "abc1234",
});

describe("reporter", () => {
  it("prints compact text with commands", async () => {
    const result = await Effect.runPromise(
      formatCheckText([finding], config, { version: "0.2.0", ci: false }).pipe(
        Effect.provide(Layer.mergeAll(NodeServices.layer, Env.layer)),
      ),
    );

    expect(result).toContain("[1]");
    expect(result).toContain("agentlint explain 1");
    expect(result).toContain("agentlint resolve 1 --accept");
    expect(result).toContain("Comments should add durable context.");
  });

  it("prints JSONL finding lines", () => {
    const result = formatCheckJsonl([finding], config);
    const parsed = JSON.parse(result) as { selector: string; detailCommand: string };
    expect(parsed.selector).toBe("1");
    expect(parsed.detailCommand).toBe("agentlint explain 1");
  });
});
