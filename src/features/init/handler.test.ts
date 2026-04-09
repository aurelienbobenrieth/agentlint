import { Effect, FileSystem, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { initHandler } from "./handler.js";
import { InitCommand } from "./request.js";

const TEST_CWD = "/tmp/agentlint-test-init";
const CONFIG_PATH = `${TEST_CWD}/agentlint.config.ts`;

const TestEnv = Layer.succeed(
  Env,
  Env.of({
    cwd: TEST_CWD,
    noColor: true,
    isTTY: false,
    setExitCode: () => {},
  }),
);

const TestLayer = Layer.provideMerge(NodeServices.layer, TestEnv);

const cleanup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(TEST_CWD, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
}).pipe(Effect.provide(TestLayer));

const ensureDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(TEST_CWD, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
}).pipe(Effect.provide(TestLayer));

describe("initHandler", () => {
  it("creates config and suggests skills add by default", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(ensureDir);

    const result = await Effect.runPromise(initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer)));

    expect(result.created).toBe(true);
    expect(result.message).toContain("Created agentlint.config.ts");
    expect(result.message).toContain(".agentlint-state to .gitignore");
    expect(result.message).toContain("Next steps:");
    expect(result.message).toContain("npx skills@latest add");

    // Verify .gitignore was created
    const gitignore = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.readFileString(`${TEST_CWD}/.gitignore`);
      }).pipe(Effect.provide(TestLayer)),
    );
    expect(gitignore).toContain(".agentlint-state");

    await Effect.runPromise(cleanup);
  });

  it("appends to existing .gitignore without duplicating", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(ensureDir);

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(`${TEST_CWD}/.gitignore`, "node_modules/\ndist/\n");
      }).pipe(Effect.provide(TestLayer)),
    );

    const result = await Effect.runPromise(initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer)));

    expect(result.message).toContain(".agentlint-state to .gitignore");

    const gitignore = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.readFileString(`${TEST_CWD}/.gitignore`);
      }).pipe(Effect.provide(TestLayer)),
    );
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain(".agentlint-state");

    // Run again — should not duplicate
    const result2 = await Effect.runPromise(initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer)));
    expect(result2.message).not.toContain(".agentlint-state to .gitignore");

    await Effect.runPromise(cleanup);
  });

  it("skips config when it already exists", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(ensureDir);

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(CONFIG_PATH, "existing");
      }).pipe(Effect.provide(TestLayer)),
    );

    const result = await Effect.runPromise(initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer)));

    expect(result.created).toBe(false);
    expect(result.message).toContain("already exists");

    await Effect.runPromise(cleanup);
  });

  it("suggests intent when @tanstack/intent is detected", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(ensureDir);

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(`${TEST_CWD}/node_modules/@tanstack/intent`, { recursive: true });
      }).pipe(Effect.provide(TestLayer)),
    );

    const result = await Effect.runPromise(initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer)));

    expect(result.message).toContain("npx @tanstack/intent install");

    await Effect.runPromise(cleanup);
  });

  it("suggests intent when AGENTS.md has intent-skills block", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(ensureDir);

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          `${TEST_CWD}/AGENTS.md`,
          "<!-- intent-skills:start -->\nskills:\n<!-- intent-skills:end -->\n",
        );
      }).pipe(Effect.provide(TestLayer)),
    );

    const result = await Effect.runPromise(initHandler(new InitCommand({})).pipe(Effect.provide(TestLayer)));

    expect(result.message).toContain("npx @tanstack/intent install");

    await Effect.runPromise(cleanup);
  });
});
