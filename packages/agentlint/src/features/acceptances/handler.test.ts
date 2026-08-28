import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { AcceptanceRecord } from "../../domain/acceptance.js";
import { normalizeConfig } from "../../domain/config.js";
import { Fingerprint } from "../../domain/fingerprint.js";
import type { FindingRecord } from "../../domain/finding.js";
import { defineRule } from "../../domain/rule.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";
import { acceptancesHandler } from "./handler.js";
import { AcceptancesCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-acceptances-test");
const agentRule = defineRule({
  lifecycle: "state",
  standard: { id: "security/danger", revision: 1, title: "Danger is reviewed", guidance: "Review danger calls." },
  detector: {
    id: "typescript/danger-call",
    version: 1,
    match: { pattern: "danger($$$ARGS)", message: "danger needs judgment" },
  },
  binding: { id: "security/danger", authority: "agent", include: ["src/**/*.ts"] },
});
const humanRule = defineRule({
  lifecycle: "state",
  standard: { id: "security/risky", revision: 1, title: "Risky is reviewed", guidance: "Review risky calls." },
  detector: {
    id: "typescript/risky-call",
    version: 1,
    match: { pattern: "risky($$$ARGS)", message: "risky needs a human" },
  },
  binding: { id: "security/risky", authority: "human", include: ["src/**/*.ts"] },
});
const TestEnv = Layer.succeed(
  Env,
  Env.of({ cwd, argv: [], actor: "agent:test", platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
);
const TestConfig = Layer.succeed(
  ConfigLoader,
  ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules: [agentRule, humanRule] })) }),
);
const TestGit = Layer.succeed(
  Git,
  Git.of({
    detectDefaultBranch: () => Effect.succeed("main"),
    changedFiles: () => Effect.succeed([]),
    changeSet: () => Effect.succeed({ baseline: { kind: "git", ref: "main" }, files: [] }),
  }),
);
const TestLayer = Layer.mergeAll(TestConfig, TestGit, Parser.layer, AcceptanceStore.layer, SelectorCache.layer).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(TestEnv),
);
const run = <A, E>(effect: Effect.Effect<A, E, Layer.Layer.Success<typeof TestLayer>>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const writeSource = (source: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
    yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), source);
  });
const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
});
const storedRecords = Effect.gen(function* () {
  return (yield* (yield* AcceptanceStore).read()).records;
});
const checkAll = checkHandler(new CheckCommand({ all: true, rules: [], base: undefined, files: [], format: "text" }));

function decision(finding: FindingRecord, authority: "agent" | "human", digest = finding.fingerprint.digest) {
  return new AcceptanceRecord({
    schemaVersion: 1,
    source: finding.source,
    fingerprint: new Fingerprint({ ...finding.fingerprint, digest }),
    lineageKey: finding.lineageKey,
    reason: `Imported for ${finding.ruleId}.`,
    authority,
    actor: "human:reviewer",
    acceptedAt: "2026-08-20T10:00:00.000Z",
  });
}

const importCommand = (imported: ReadonlyArray<AcceptanceRecord>) =>
  acceptancesHandler(new AcceptancesCommand({ action: "import", base: undefined, imported }));

beforeEach(async () => {
  await run(cleanup);
  await run(writeSource('danger("x")\nrisky("y")\n'));
});
afterEach(() => run(cleanup));

describe("acceptances import", () => {
  it("imports every decision when all of them identify current findings with enough authority", async () => {
    const check = await run(checkAll);
    expect(check.unresolved).toHaveLength(2);
    const [danger, risky] = check.unresolved;
    if (!danger || !risky) throw new Error("expected two findings");

    const result = await run(importCommand([decision(danger, "agent"), decision(risky, "human")]));
    expect(result.exitCode).toBe(0);
    expect(result.importedCount).toBe(2);
    expect(result.rejectedCount).toBe(0);
    expect(result.records).toHaveLength(2);
    expect(await run(storedRecords)).toHaveLength(2);

    const after = await run(checkAll);
    expect(after.exitCode).toBe(0);
    expect(after.accepted).toHaveLength(2);
  });

  it("rejects the whole import when one decision no longer matches a current finding", async () => {
    const check = await run(checkAll);
    const [danger, risky] = check.unresolved;
    if (!danger || !risky) throw new Error("expected two findings");

    const result = await run(
      importCommand([decision(danger, "agent"), decision(risky, "human", "0000000000000000stale")]),
    );
    expect(result.exitCode).toBe(2);
    expect(result.importedCount).toBe(0);
    expect(result.rejectedCount).toBe(1);
    expect(result.records).toEqual([]);
    expect(await run(storedRecords)).toEqual([]);
  });

  it("rejects an agent decision for a finding that requires human authority", async () => {
    const check = await run(checkAll);
    const risky = check.unresolved.find((finding) => finding.ruleId === "security/risky");
    if (!risky) throw new Error("expected the human-authority finding");

    const result = await run(importCommand([decision(risky, "agent")]));
    expect(result.exitCode).toBe(2);
    expect(result.importedCount).toBe(0);
    expect(result.rejectedCount).toBe(1);
    expect(await run(storedRecords)).toEqual([]);
  });
});
