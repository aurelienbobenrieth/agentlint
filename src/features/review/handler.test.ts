import { Effect, HashSet, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineConfig } from "../../index.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { StateStore } from "../../shared/infrastructure/state-store.js";
import { reviewHandler } from "./handler.js";
import { ReviewCommand } from "./request.js";

const testConfig = defineConfig({ rules: {} });

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

let stateHashes: HashSet.HashSet<string> = HashSet.empty();

const TestStateStore = Layer.succeed(
  StateStore,
  StateStore.of({
    load: () => Effect.succeed(stateHashes),
    append: (hashes) =>
      Effect.sync(() => {
        stateHashes = hashes.reduce((acc, h) => HashSet.add(acc, h), stateHashes);
      }),
    reset: () =>
      Effect.sync(() => {
        stateHashes = HashSet.empty();
      }),
  }),
);

const TestLayer = Layer.mergeAll(TestConfigLoader, Parser.layer, TestGit, TestStateStore).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(Env.layer),
);

describe("reviewHandler", () => {
  it("resets state and returns appropriate message", async () => {
    // Seed some state first
    stateHashes = HashSet.fromIterable(["abc1234", "def5678"]);

    const result = await Effect.runPromise(
      reviewHandler(
        new ReviewCommand({
          hashes: [],
          all: false,
          reset: true,
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("ReviewResult");
    expect(result.message).toContain("Cleared .agentlint-state");
    expect(HashSet.size(stateHashes)).toBe(0);
  });

  it("marks specific hashes as reviewed", async () => {
    stateHashes = HashSet.empty();

    const result = await Effect.runPromise(
      reviewHandler(
        new ReviewCommand({
          hashes: ["hash1", "hash2", "hash3"],
          all: false,
          reset: false,
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("ReviewResult");
    expect(result.message).toContain("3 hash(es) as reviewed");
    expect(HashSet.has(stateHashes, "hash1")).toBe(true);
    expect(HashSet.has(stateHashes, "hash2")).toBe(true);
    expect(HashSet.has(stateHashes, "hash3")).toBe(true);
  });

  it("returns no flags message when --all with empty project", async () => {
    stateHashes = HashSet.empty();

    const result = await Effect.runPromise(
      reviewHandler(
        new ReviewCommand({
          hashes: [],
          all: true,
          reset: false,
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("ReviewResult");
    expect(result.message).toContain("No flags to review");
  });

  it("shows usage when no options provided", async () => {
    stateHashes = HashSet.empty();

    const result = await Effect.runPromise(
      reviewHandler(
        new ReviewCommand({
          hashes: [],
          all: false,
          reset: false,
        }),
      ).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("ReviewResult");
    expect(result.message).toContain("Usage:");
    expect(result.message).toContain("agentlint review");
  });
});
