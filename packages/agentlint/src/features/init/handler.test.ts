import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
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
  it("creates the minimal config and ignores only ephemeral state", async () => {
    await Effect.runPromise(cleanup);
    const result = await Effect.runPromise(initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer)));
    expect(result.created).toBe(true);
    expect(result.message).toContain("Created .agentlint/config.ts");
    const config = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* FileSystem.FileSystem).readFileString(join(cwd, ".agentlint", "config.ts"));
      }).pipe(Effect.provide(TestLayer)),
    );
    expect(config).toContain("rules: []");
    expect(config).not.toContain("harness");
  });

  it("does not overwrite an existing config", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
        yield* fs.writeFileString(join(cwd, ".agentlint", "config.ts"), "keep me");
      }).pipe(Effect.provide(TestLayer)),
    );
    const result = await Effect.runPromise(initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer)));
    expect(result.created).toBe(false);
    expect(result.message).toContain("Kept existing");
  });
});
