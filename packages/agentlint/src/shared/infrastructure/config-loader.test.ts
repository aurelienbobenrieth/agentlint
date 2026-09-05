import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { ConfigLoader } from "./config-loader.js";

const TEST_CWD = join(tmpdir(), "agentlint-test-config-loader");
const CONFIG_DIR = `${TEST_CWD}/.agentlint`;
const CONFIG_PATH = `${CONFIG_DIR}/config.ts`;
/** Separate directory: jiti caches modules by path, so the alias case must not reuse CONFIG_PATH. */
const ALIAS_CWD = join(tmpdir(), "agentlint-test-config-loader-alias");

const testEnv = (cwd: string) =>
  Layer.succeed(
    Env,
    Env.of({
      cwd,
      argv: [],
      actor: "agent:test",
      platform: "test",
      noColor: true,
      isTTY: false,
      setExitCode: () => {},
    }),
  );

const testLayer = (cwd: string) =>
  ConfigLoader.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(testEnv(cwd)));
const TestLayer = testLayer(TEST_CWD);

const cleanup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  for (const dir of [TEST_CWD, ALIAS_CWD]) {
    yield* fs.remove(dir, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
  }
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
        yield* fs.writeFileString(CONFIG_PATH, 'export default { rules: [], base: "main" }\n');
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    const config = await Effect.runPromise(
      Effect.gen(function* () {
        const loader = yield* ConfigLoader;
        return yield* loader.load();
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(config.rules).toEqual([]);
    expect(config.base).toBe("main");

    await Effect.runPromise(cleanup);
  });

  it("resolves @aurelienbbn/agentlint to the running package without node_modules", async () => {
    await Effect.runPromise(cleanup);

    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(ALIAS_CWD, ".agentlint"), { recursive: true });
        yield* fs.writeFileString(
          join(ALIAS_CWD, ".agentlint", "config.ts"),
          `import { defineConfig, defineRule } from "@aurelienbbn/agentlint";
import { testRuleFixtures } from "@aurelienbbn/agentlint/testing";
import { ReviewArtifact } from "@aurelienbbn/agentlint/contract";
if (typeof testRuleFixtures !== "function" || !ReviewArtifact) throw new Error("subpath alias failed");
export default defineConfig({
  rules: [
    defineRule({
      lifecycle: "state",
      standard: { id: "demo/danger", revision: 1, title: "Danger is reviewed", guidance: "Review it." },
      detector: { id: "typescript/danger", version: 1, match: { pattern: "danger($$$A)", message: "danger" } },
      binding: { id: "demo/danger", authority: "agent", include: ["src/**/*.ts"] },
    }),
  ],
});
`,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    const config = await Effect.runPromise(
      Effect.gen(function* () {
        const loader = yield* ConfigLoader;
        return yield* loader.load();
      }).pipe(Effect.provide(testLayer(ALIAS_CWD))),
    );

    expect(config.rules.map((rule) => rule.binding.id)).toEqual(["demo/danger"]);
    expect(config.rules[0]?.standard.title).toBe("Danger is reviewed");

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
