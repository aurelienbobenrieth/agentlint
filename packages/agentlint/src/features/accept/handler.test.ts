import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { normalizeConfig } from "../../domain/config.js";
import { defineRule } from "../../domain/rule.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";
import { acceptHandler } from "./handler.js";
import { AcceptCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-accept-test");
const humanRule = defineRule({
  lifecycle: "state",
  standard: { id: "security/danger", revision: 1, title: "Danger is reviewed", guidance: "Review danger calls." },
  detector: {
    id: "typescript/danger-call",
    version: 1,
    match: { pattern: "danger($$$ARGS)", message: "danger needs judgment" },
  },
  binding: { id: "security/danger", authority: "human", include: ["src/**/*.ts"] },
});
const testEnv = (actor: string) =>
  Layer.succeed(
    Env,
    Env.of({ cwd, argv: [], actor, platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
  );
const TestConfig = Layer.succeed(
  ConfigLoader,
  ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules: [humanRule] })) }),
);
const TestGit = Layer.succeed(
  Git,
  Git.of({
    detectDefaultBranch: () => Effect.succeed("main"),
    changedFiles: () => Effect.succeed([]),
    changeSet: () => Effect.succeed({ baseline: { kind: "git", ref: "main" }, files: [] }),
  }),
);
const services = Layer.mergeAll(TestConfig, TestGit, Parser.layer, AcceptanceStore.layer, SelectorCache.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
);
const layerFor = (actor: string) => services.pipe(Layer.provideMerge(testEnv(actor)));
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<ReturnType<typeof layerFor>>>, actor = "agent:test") =>
  Effect.runPromise(effect.pipe(Effect.provide(layerFor(actor))));

const writeSource = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
  yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), 'danger("x")');
});
const check = checkHandler(new CheckCommand({ all: true, rules: [], base: undefined, files: [] }));
const accept = (authority: "agent" | "human", reason: string | undefined, selector?: string) =>
  acceptHandler(new AcceptCommand({ selector, reason, authority, base: undefined }));
const storedAuthorities = Effect.map(
  Effect.flatMap(AcceptanceStore, (store) => store.read()),
  ({ records }) => records.map((record) => record.authority),
);

afterEach(() =>
  run(
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  ),
);

describe("accept and approve", () => {
  it("refuses agent authority on a human binding and records nothing", async () => {
    await run(writeSource);
    expect((await run(check)).exitCode).toBe(1);

    const refused = await run(accept("agent", "The call is sandboxed.", "1"));
    expect(refused.exitCode).toBe(2);
    expect(refused.message).toContain("requires human acceptance");
    expect(await run(storedAuthorities)).toEqual([]);
    expect((await run(check)).exitCode).toBe(1);
  });

  it("opens the gate when a human approves the same finding", async () => {
    await run(writeSource);
    await run(check);

    const approved = await run(accept("human", "  Reviewed the sandbox boundary.  ", "1"), "human:reviewer");
    expect(approved.exitCode).toBe(0);
    expect(approved.message).toBe("Accepted security/danger at src/demo.ts:1.");
    const { records } = await run(Effect.flatMap(AcceptanceStore, (store) => store.read()));
    expect(records.map(({ authority, reason, actor }) => ({ authority, reason, actor }))).toEqual([
      { authority: "human", reason: "Reviewed the sandbox boundary.", actor: "human:reviewer" },
    ]);
    expect((await run(check)).exitCode).toBe(0);
  });

  it("refuses to mint human authority from an agent process", async () => {
    await run(writeSource);
    await run(check);

    const refused = await run(accept("human", "Reviewed.", "1"));
    expect(refused).toMatchObject({ exitCode: 2, message: expect.stringContaining("human actor") });
    expect(await run(storedAuthorities)).toEqual([]);
  });

  it("rejects a missing selector, a blank reason, and an unknown selector without writing", async () => {
    await run(writeSource);
    await run(check);

    expect(await run(accept("human", "Reviewed."))).toMatchObject({ exitCode: 2 });
    expect(await run(accept("human", "   ", "1"))).toMatchObject({
      exitCode: 2,
      message: expect.stringContaining("reason"),
    });
    expect(await run(accept("human", "Reviewed.", "99"))).toMatchObject({ exitCode: 2 });
    expect(await run(storedAuthorities)).toEqual([]);
  });
});
