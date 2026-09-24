import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Env } from "../../config/env.js";
import { initHandler } from "./handler.js";
import { InitCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-init-test");
const TestEnv = Layer.succeed(
  Env,
  Env.of({ cwd, argv: [], actor: "human:test", platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
);
const TestLayer = Layer.provideMerge(NodeServices.layer, TestEnv);
const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.provide(TestLayer));

afterEach(() => Effect.runPromise(cleanup));

describe("agentlint init", () => {
  it.effect("composes explicitly selected packages without installing or executing them", () =>
    Effect.gen(function* () {
      const result = yield* initHandler(
        new InitCommand({
          presets: ["@example/core#starterPreset", "@example/ui#uiPreset", "@example/core#starterPreset"],
        }),
      ).pipe(Effect.provide(TestLayer));
      const text = yield* Effect.gen(function* () {
        return yield* (yield* FileSystem.FileSystem).readFileString(join(cwd, ".agentlint", "config.ts"));
      }).pipe(Effect.provide(TestLayer));
      expect(text).toContain('import { starterPreset as preset0 } from "@example/core"');
      expect(text).toContain("extends: [preset0, preset1]");
      expect(result.message).toContain("pnpm add -D @example/core @example/ui");
      expect(text).not.toContain("preset2");
    }),
  );

  it.effect("rejects injected imports before changing the repository", () =>
    Effect.gen(function* () {
      const result = yield* initHandler(new InitCommand({ presets: ['example#x; throw Error("executed")'] })).pipe(
        Effect.result,
        Effect.provide(TestLayer),
      );
      expect(result._tag).toBe("Failure");
      expect(
        yield* Effect.gen(function* () {
          return yield* (yield* FileSystem.FileSystem).exists(join(cwd, ".agentlint", "config.ts"));
        }).pipe(Effect.provide(TestLayer)),
      ).toBe(false);
    }),
  );
  it.effect("creates the minimal config and ignores only ephemeral state", () =>
    Effect.gen(function* () {
      yield* cleanup;
      const result = yield* initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer));
      expect(result.created).toBe(true);
      expect(result.message).toContain("Created .agentlint/config.ts");
      const config = yield* Effect.gen(function* () {
        return yield* (yield* FileSystem.FileSystem).readFileString(join(cwd, ".agentlint", "config.ts"));
      }).pipe(Effect.provide(TestLayer));
      expect(config).toContain("rules: []");
      expect(config).not.toContain("harness");
    }),
  );

  it.effect("does not overwrite an existing config", () =>
    Effect.gen(function* () {
      yield* cleanup;
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
        yield* fs.writeFileString(join(cwd, ".agentlint", "config.ts"), "keep me");
      }).pipe(Effect.provide(TestLayer));
      const result = yield* initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer));
      expect(result.created).toBe(false);
      expect(result.message).toContain("Kept existing");
    }),
  );
});
