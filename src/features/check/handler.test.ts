import { Effect, FileSystem, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { randomUUID } from "node:crypto";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineConfig, defineRule } from "../../index.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { LedgerRecord, LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { checkHandler } from "./handler.js";
import { CheckCommand } from "./request.js";

const commentRule = defineRule({
  id: "comments/no-noise",
  description: "Flags comments.",
  guidance: "Comments should add durable context.",
  createOnce(context) {
    return {
      comment(node) {
        context.report({ node, message: "Comment needs a disposition." });
      },
    };
  },
});

const REPO_ROOT = process.cwd();

const config = defineConfig({
  rules: { "comments/no-noise": commentRule },
  files: ["src/**/*.ts"],
});

function testLayer(cwd: string) {
  const TestEnv = Layer.succeed(
    Env,
    Env.of({
      cwd,
      argv: [],
      actor: "agent:test",
      noColor: true,
      isTTY: false,
      setExitCode: () => {},
    }),
  );

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
      changedFiles: () => Effect.succeed(["src/sample.ts"]),
    }),
  );

  return Layer.mergeAll(TestConfigLoader, Parser.layer, TestGit, LedgerStore.layer, SelectorCache.layer).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(TestEnv),
  );
}

function setup(cwd: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(join(cwd, "src"), { recursive: true });
    yield* Effect.tryPromise({
      try: () => symlink(join(REPO_ROOT, "node_modules"), join(cwd, "node_modules"), "junction"),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));
    yield* fs.writeFileString(join(cwd, "src", "sample.ts"), "export const value = 1;\n// durable context\n");
  });
}

function cleanup(cwd: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
  });
}

const check = (ci = false) =>
  checkHandler(
    new CheckCommand({
      all: true,
      rules: [],
      base: undefined,
      files: [],
      format: "text",
      ci,
    }),
  );

function appendRecord(finding: { readonly ruleId: string; readonly hash: string }, status: LedgerRecord["status"]) {
  return Effect.gen(function* () {
    const ledger = yield* LedgerStore;
    yield* ledger.append(
      new LedgerRecord({
        version: 1,
        persistence: undefined,
        ruleId: finding.ruleId,
        hash: finding.hash,
        status,
        reason: `${status} in test`,
        actor: "agent:test",
        at: "2026-06-22T00:00:00.000Z",
        summary: undefined,
        adr: undefined,
      }),
    );
  });
}

describe("checkHandler", () => {
  it("blocks unresolved findings", async () => {
    const cwd = join(tmpdir(), `agentlint-check-${randomUUID()}`);
    const layer = testLayer(cwd);

    try {
      await Effect.runPromise(setup(cwd).pipe(Effect.provide(layer)));
      const result = await Effect.runPromise(check().pipe(Effect.provide(layer)));

      expect(result.exitCode).toBe(1);
      expect(result.unresolvedCount).toBe(1);
      expect(result.displayedFindings).toHaveLength(1);
      expect(result.displayedFindings[0]?.selector).toBe("1");
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(layer)));
    }
  });

  it("hides accepted findings and exits cleanly", async () => {
    const cwd = join(tmpdir(), `agentlint-check-${randomUUID()}`);
    const layer = testLayer(cwd);

    try {
      await Effect.runPromise(setup(cwd).pipe(Effect.provide(layer)));
      const first = await Effect.runPromise(check().pipe(Effect.provide(layer)));
      const [finding] = first.findings;
      expect(finding).toBeDefined();
      await Effect.runPromise(appendRecord(finding, "accepted").pipe(Effect.provide(layer)));

      const result = await Effect.runPromise(check().pipe(Effect.provide(layer)));

      expect(result.exitCode).toBe(0);
      expect(result.resolvedCount).toBe(1);
      expect(result.displayedFindings).toHaveLength(0);
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(layer)));
    }
  });

  it("allows deferred findings locally and blocks them in CI", async () => {
    const cwd = join(tmpdir(), `agentlint-check-${randomUUID()}`);
    const layer = testLayer(cwd);

    try {
      await Effect.runPromise(setup(cwd).pipe(Effect.provide(layer)));
      const first = await Effect.runPromise(check().pipe(Effect.provide(layer)));
      const [finding] = first.findings;
      expect(finding).toBeDefined();
      await Effect.runPromise(appendRecord(finding, "deferred").pipe(Effect.provide(layer)));

      const local = await Effect.runPromise(check(false).pipe(Effect.provide(layer)));
      const ci = await Effect.runPromise(check(true).pipe(Effect.provide(layer)));

      expect(local.exitCode).toBe(0);
      expect(local.displayedFindings).toHaveLength(0);
      expect(ci.exitCode).toBe(1);
      expect(ci.displayedFindings).toHaveLength(1);
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(layer)));
    }
  });
});
