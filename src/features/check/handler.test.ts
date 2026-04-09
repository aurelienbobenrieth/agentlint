import { Effect, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineConfig, defineRule } from "../../index.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { StateStore } from "../../shared/infrastructure/state-store.js";
import { checkHandler } from "./handler.js";
import { CheckCommand } from "./request.js";

const fixturesDir = resolve(import.meta.dirname, "../../__fixtures__");

const testRule = defineRule({
  meta: {
    name: "test-comments",
    description: "Flags all comments",
    languages: ["ts", "tsx"],
    instruction: "Evaluate comments.",
  },
  createOnce(context) {
    return {
      comment(node) {
        const text = node.text.replace(/^\/\/\s*/, "").trim();
        if (text === "") return;
        context.flag({ node, message: `Comment: "${text.slice(0, 40)}"` });
      },
    };
  },
});

const testConfig = defineConfig({
  rules: { "test-comments": testRule },
});

const TestConfigLoader = Layer.succeed(
  ConfigLoader,
  ConfigLoader.of({
    load: () => Effect.succeed(testConfig),
  }),
);

const TestGit = Layer.succeed(
  Git,
  Git.of({
    detectDefaultBranch: () => Effect.succeed("main"),
    changedFiles: () => Effect.succeed([]),
  }),
);

const TestLayer = Layer.mergeAll(TestConfigLoader, Parser.layer, TestGit, StateStore.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(Env.layer),
);

describe("checkHandler", () => {
  it("finds comments in fixture files", async () => {
    const result = await Effect.runPromise(
      checkHandler(
        new CheckCommand({
          all: false,
          rules: [],
          dryRun: false,
          base: undefined,
          files: [resolve(fixturesDir, "sample.ts")],
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("CheckResult");
    expect(result.noMatchingRules).toBe(false);
    expect(result.flags.length).toBeGreaterThan(0);
    expect(result.flags.some((f) => f.ruleName === "test-comments")).toBe(true);
  });

  it("returns noMatchingRules when filter matches nothing", async () => {
    const result = await Effect.runPromise(
      checkHandler(
        new CheckCommand({
          all: false,
          rules: ["nonexistent-rule"],
          dryRun: false,
          base: undefined,
          files: [resolve(fixturesDir, "sample.ts")],
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    expect(result.noMatchingRules).toBe(true);
    expect(result.availableRules).toContain("test-comments");
  });

  it("returns empty flags when no rules trigger", async () => {
    const result = await Effect.runPromise(
      checkHandler(
        new CheckCommand({
          all: false,
          rules: [],
          dryRun: false,
          base: undefined,
          files: [], // empty files = no work
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    expect(result.flags.length).toBe(0);
  });
});
