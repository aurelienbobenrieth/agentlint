import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { ConfigLoader } from "./config-loader.js";

const TEST_CWD = "/tmp/agentlint-test-config-loader";
const CONFIG_DIR = `${TEST_CWD}/.agentlint`;
const CONFIG_PATH = `${CONFIG_DIR}/config.ts`;

const TestEnv = Layer.succeed(
  Env,
  Env.of({
    cwd: TEST_CWD,
    noColor: true,
    isTTY: false,
    setExitCode: () => {},
  }),
);

const TestLayer = ConfigLoader.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(TestEnv));

const cleanup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(TEST_CWD, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
}).pipe(Effect.provide(NodeServices.layer));

const ensureDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(TEST_CWD, { recursive: true });
}).pipe(Effect.provide(NodeServices.layer));

describe("ConfigLoader", () => {
  it("loads .agentlint/config.ts", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(ensureDir);

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(CONFIG_DIR, { recursive: true });
        yield* fs.writeFileString(CONFIG_PATH, "export default { rules: {} }\n");
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    const config = await Effect.runPromise(
      Effect.gen(function* () {
        const loader = yield* ConfigLoader;
        return yield* loader.load();
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(config.rules).toEqual({});

    await Effect.runPromise(cleanup);
  });

  it("does not fall back to root agentlint.config.ts", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(ensureDir);

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(`${TEST_CWD}/agentlint.config.ts`, "export default { rules: {} }\n");
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const loader = yield* ConfigLoader;
          return yield* loader.load();
        }).pipe(Effect.provide(TestLayer)),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Create .agentlint/config.ts"),
    });

    await Effect.runPromise(cleanup);
  });
});
