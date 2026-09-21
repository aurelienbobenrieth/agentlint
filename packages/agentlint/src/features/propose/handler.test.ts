import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { normalizeConfig } from "../../domain/config.js";
import { findProposal } from "../../domain/proposal.js";
import { defineRule } from "../../domain/rule.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";
import { proposeHandler } from "./handler.js";
import { ProposeCommand } from "./request.js";

const cwd = join(tmpdir(), `agentlint-v02-propose-${randomUUID()}`);
const rule = defineRule({
  lifecycle: "state",
  standard: { id: "security/danger", revision: 1, title: "Danger is reviewed", guidance: "Review danger calls." },
  detector: {
    id: "typescript/danger-call",
    version: 1,
    match: { pattern: "danger($$$ARGS)", message: "danger needs judgment" },
  },
  binding: { id: "security/danger", authority: "human", include: ["src/**/*.ts"] },
});
const TestLayer = Layer.mergeAll(
  Layer.succeed(ConfigLoader, ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules: [rule] })) })),
  Layer.succeed(
    Git,
    Git.of({
      detectDefaultBranch: () => Effect.succeed("main"),
      changedFiles: () => Effect.succeed([]),
      changeSet: () => Effect.succeed({ baseline: { kind: "git", ref: "main" }, files: [] }),
    }),
  ),
  Parser.layer,
  AcceptanceStore.layer,
  ProposalStore.layer,
  SelectorCache.layer,
).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(
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
    ),
  ),
);
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof TestLayer>>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const writeSource = (source: string, file = "demo.ts") =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
    yield* fs.writeFileString(path.resolve(cwd, "src", file), source);
  });
const check = checkHandler(new CheckCommand({ all: true, rules: [], base: undefined, files: [] }));
const propose = (input: { selector?: string; summary?: string; diff?: string }) =>
  proposeHandler(
    new ProposeCommand({ selector: input.selector, summary: input.summary, diff: input.diff, base: undefined }),
  );
const proposals = Effect.flatMap(ProposalStore, (store) => store.read());

afterEach(() =>
  run(
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  ),
);

describe("propose", () => {
  it("records the agent's work for the exact finding and leaves the gate closed", async () => {
    await run(writeSource('danger("x")'));
    const [finding] = (await run(check)).findings;
    if (!finding) throw new Error("Expected a finding");

    const result = await run(propose({ selector: "1", summary: "  Wrapped the call in the sandbox.  ", diff: "+x" }));
    expect(result).toMatchObject({ exitCode: 0, message: expect.stringContaining("src/demo.ts:1") });

    const stored = findProposal(await run(proposals), finding);
    expect(stored).toMatchObject({ summary: "Wrapped the call in the sandbox.", diff: "+x", actor: "agent:test" });
    expect((await run(check)).exitCode).toBe(1);
    expect((await run(Effect.flatMap(AcceptanceStore, (store) => store.read()))).records).toEqual([]);
  });

  it("keeps one proposal per finding, replaces it, and omits an empty diff", async () => {
    await run(writeSource('danger("x");\ndanger("y");'));
    await run(check);

    await run(propose({ selector: "1", summary: "First attempt.", diff: "+first" }));
    await run(propose({ selector: "2", summary: "Other finding." }));
    await run(propose({ selector: "1", summary: "Second attempt.", diff: "   " }));

    const stored = await run(proposals);
    expect(stored.map(({ summary }) => summary).toSorted()).toEqual(["Other finding.", "Second attempt."]);
    expect(stored.find(({ summary }) => summary === "Second attempt.")).not.toHaveProperty("diff");
  });

  it("stops matching once the evidence changes", async () => {
    await run(writeSource('danger("x")'));
    await run(check);
    await run(propose({ selector: "1", summary: "Reviewed the literal argument." }));

    await run(writeSource('danger(userInput ?? "x")'));
    const [edited] = (await run(check)).findings;
    if (!edited) throw new Error("Expected a finding");
    expect(findProposal(await run(proposals), edited)).toBeUndefined();
  });

  it("drops a proposal when a complete check no longer finds its evidence, and never on a partial one", async () => {
    await run(writeSource('danger("x");', "a.ts"));
    await run(writeSource('danger("y");', "demo.ts"));
    await run(check);
    await run(propose({ selector: "1", summary: "About x." }));
    await run(propose({ selector: "2", summary: "About y." }));

    await run(writeSource("safe();", "a.ts"));
    const partial = new CheckCommand({
      all: false,
      rules: [],
      base: undefined,
      files: ["src/demo.ts"],
    });
    await run(checkHandler(partial));
    expect(await run(proposals)).toHaveLength(2);

    await run(check);
    expect((await run(proposals)).map(({ summary }) => summary)).toEqual(["About y."]);
  });

  it("rejects incomplete or unknown input without writing", async () => {
    await run(writeSource('danger("x")'));
    await run(check);

    expect(await run(propose({ summary: "No selector." }))).toMatchObject({ exitCode: 2 });
    expect(await run(propose({ selector: "1", summary: "   " }))).toMatchObject({
      exitCode: 2,
      message: expect.stringContaining("summary"),
    });
    expect(await run(propose({ selector: "99", summary: "Unknown finding." }))).toMatchObject({ exitCode: 2 });
    expect(await run(proposals)).toEqual([]);
  });
});

describe("proposal store", () => {
  const file = join(cwd, ".agentlint", "proposals.jsonl");

  it("drops proposals whose finding is gone from a complete view", async () => {
    await run(writeSource('danger("x");\ndanger("y");'));
    const { findings } = await run(check);
    await run(propose({ selector: "1", summary: "Kept." }));
    await run(propose({ selector: "2", summary: "Dropped." }));

    const kept = await run(Effect.flatMap(ProposalStore, (store) => store.prune(findings.slice(0, 1))));
    expect(kept.map(({ summary }) => summary)).toEqual(["Kept."]);
    expect((await run(proposals)).map(({ summary }) => summary)).toEqual(["Kept."]);
  });

  it("reads a missing file as empty and reports the line of a corrupt record", async () => {
    expect(await run(proposals)).toEqual([]);
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
        yield* fs.writeFileString(file, '\n{"schemaVersion":1}\n');
      }),
    );
    const error = await run(Effect.flip(proposals));
    expect(error).toMatchObject({ reason: "invalid_record", line: 2 });
    expect(error.message).toContain("line 2");
  });

  it("lets the last record win when a merge left two for one finding", async () => {
    await run(writeSource('danger("x")'));
    await run(check);
    await run(propose({ selector: "1", summary: "Ours." }));
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const ours = yield* fs.readFileString(file);
        yield* fs.writeFileString(file, `${ours}${ours.replace("Ours.", "Theirs.")}`);
      }),
    );
    expect((await run(proposals)).map(({ summary }) => summary)).toEqual(["Theirs."]);
  });
});
