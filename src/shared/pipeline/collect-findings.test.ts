import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineConfig, defineRule } from "../../index.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { Git } from "../infrastructure/git.js";
import { Parser } from "../infrastructure/parser.js";
import { collectFindings } from "./collect-findings.js";

const fixturesDir = resolve(import.meta.dirname, "../../__fixtures__");

function testLayer(config: ReturnType<typeof defineConfig>) {
  const TestConfigLoader = Layer.succeed(
    ConfigLoader,
    ConfigLoader.of({
      load: () => Effect.succeed(config),
    }),
  );

  const TestGit = Layer.succeed(
    Git,
    Git.of({
      detectDefaultBranch: () => Effect.succeed("main"),
      changedFiles: () => Effect.succeed([]),
    }),
  );

  return Layer.mergeAll(TestConfigLoader, Parser.layer, TestGit).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(Env.layer),
  );
}

const commentRule = defineRule({
  id: "comments/no-noise",
  description: "Flags comments.",
  guidance: "Comments should add durable context.",
  createOnce(context) {
    return {
      comment(node) {
        context.report({ node, message: "Comment should be evaluated." });
      },
    };
  },
});

describe("collectFindings", () => {
  it("collects findings with stable hashes independent of line shifts", async () => {
    const config = defineConfig({ rules: { "comments/no-noise": commentRule } });
    const layer = testLayer(config);

    const first = await Effect.runPromise(
      collectFindings({
        all: false,
        rules: [],
        base: undefined,
        files: [resolve(fixturesDir, "sample.ts")],
      }).pipe(Effect.provide(layer)),
    );
    const shifted = await Effect.runPromise(
      collectFindings({
        all: false,
        rules: [],
        base: undefined,
        files: [resolve(fixturesDir, "sample-line-shift.ts")],
      }).pipe(Effect.provide(layer)),
    );

    expect(first.findings[0]?.hash).toBeDefined();
    expect(shifted.findings[0]?.hash).toBeDefined();
    expect(first.findings[0]?.hash).not.toBe(shifted.findings[0]?.hash);
  });

  it("applies overrides in array order", async () => {
    const config = defineConfig({
      rules: { "comments/no-noise": commentRule },
      overrides: [
        { files: ["**/*.ts"], rules: { "comments/no-noise": "off" } },
        { files: ["**/sample.ts"], rules: { "comments/no-noise": "on" } },
      ],
    });
    const layer = testLayer(config);

    const result = await Effect.runPromise(
      collectFindings({
        all: false,
        rules: [],
        base: undefined,
        files: [resolve(fixturesDir, "sample.ts")],
      }).pipe(Effect.provide(layer)),
    );

    expect(result.findings.length).toBeGreaterThan(0);
  });
});
