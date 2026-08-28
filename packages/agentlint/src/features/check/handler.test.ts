import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineRule } from "../../domain/rule.js";
import { acceptFinding } from "../accept/handler.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { checkHandler } from "./handler.js";
import { CheckCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-check-test");
const rule = defineRule({
  lifecycle: "state",
  standard: { id: "security/danger", revision: 1, title: "Danger is reviewed", guidance: "Review danger calls." },
  detector: {
    id: "typescript/danger-call",
    version: 1,
    match: { pattern: "danger($$$ARGS)", message: "danger needs judgment" },
  },
  binding: { id: "security/danger", authority: "agent", include: ["src/**/*.ts"] },
});
const TestEnv = Layer.succeed(
  Env,
  Env.of({ cwd, argv: [], actor: "agent:test", platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
);
const TestConfig = Layer.succeed(ConfigLoader, ConfigLoader.of({ load: () => Effect.succeed({ rules: [rule] }) }));
const TestGit = Layer.succeed(
  Git,
  Git.of({
    detectDefaultBranch: () => Effect.succeed("main"),
    changedFiles: () => Effect.succeed([]),
    changeSet: () => Effect.succeed({ baseline: { kind: "git", ref: "main" }, files: [] }),
    showFile: () => Effect.succeed(undefined),
  }),
);
const TestLayer = Layer.mergeAll(TestConfig, TestGit, Parser.layer, AcceptanceStore.layer, SelectorCache.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(TestEnv),
);
const command = new CheckCommand({ all: true, rules: [], base: undefined, files: [], format: "text" });

const writeSource = (source: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
    yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), source);
  }).pipe(Effect.provide(TestLayer));
const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.provide(TestLayer));

afterEach(() => Effect.runPromise(cleanup));

describe("binary check and acceptance loop", () => {
  it("preserves formatting-only decisions and invalidates material evidence with transient lineage", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(writeSource('danger("x")\n'));

    const first = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    expect(first.exitCode).toBe(1);
    expect(first.unresolved).toHaveLength(1);

    const finding = first.unresolved[0];
    expect(finding).toBeDefined();
    if (finding === undefined) return;
    await Effect.runPromise(
      acceptFinding(finding, { authority: "agent", reason: "The sandbox owns this call." }).pipe(
        Effect.provide(TestLayer),
      ),
    );
    await Effect.runPromise(writeSource('\n\n  danger( "x" )\n'));
    const moved = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    expect(moved.exitCode).toBe(0);
    expect(moved.accepted).toHaveLength(1);

    await Effect.runPromise(writeSource('danger("x", "new evidence")\n'));
    const changed = await Effect.runPromise(checkHandler(command).pipe(Effect.provide(TestLayer)));
    expect(changed.exitCode).toBe(1);
    expect(changed.lineage).toMatchObject([{ reason: "The sandbox owns this call.", authority: "agent" }]);
    expect(changed.staleCount).toBe(1);
    expect(await Effect.runPromise(readStoredAcceptances)).toEqual([]);
  });
});

const readStoredAcceptances = Effect.gen(function* () {
  return (yield* (yield* AcceptanceStore).read()).records;
}).pipe(Effect.provide(TestLayer));
