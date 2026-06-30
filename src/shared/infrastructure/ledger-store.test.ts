import { Effect, FileSystem, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { LedgerRecord, LedgerStore } from "./ledger-store.js";

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

  return LedgerStore.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(TestEnv));
}

function cleanup(cwd: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
  });
}

function record(hash = "abc123") {
  return new LedgerRecord({
    version: 1,
    persistence: undefined,
    ruleId: "comments/no-noise",
    hash,
    status: "accepted",
    reason: "Explains the exception.",
    actor: "agent:test",
    at: "2026-06-22T00:00:00.000Z",
    summary: undefined,
    adr: undefined,
  });
}

describe("LedgerStore", () => {
  it("treats a missing ledger as empty", async () => {
    const cwd = join(tmpdir(), `agentlint-ledger-${randomUUID()}`);
    const layer = testLayer(cwd);

    try {
      const snapshot = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerStore;
          return yield* ledger.read();
        }).pipe(Effect.provide(layer)),
      );

      expect(snapshot.records).toHaveLength(0);
      expect(snapshot.latestByKey.size).toBe(0);
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(layer)));
    }
  });

  it("does not append exact duplicate dispositions", async () => {
    const cwd = join(tmpdir(), `agentlint-ledger-${randomUUID()}`);
    const layer = testLayer(cwd);

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const ledger = yield* LedgerStore;
          const first = yield* ledger.append(record());
          const second = yield* ledger.append(record());
          const snapshot = yield* ledger.read();
          return { first, second, snapshot };
        }).pipe(Effect.provide(layer)),
      );

      expect(result.first.appended).toBe(true);
      expect(result.second.appended).toBe(false);
      expect(result.snapshot.records).toHaveLength(1);
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(layer)));
    }
  });

  it("reports invalid ledger line numbers", async () => {
    const cwd = join(tmpdir(), `agentlint-ledger-${randomUUID()}`);
    const layer = testLayer(cwd);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
          yield* fs.writeFileString(join(cwd, ".agentlint", "ledger.jsonl"), '{"bad":true}\n');
        }).pipe(Effect.provide(layer)),
      );

      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const ledger = yield* LedgerStore;
          return yield* ledger.read();
        }).pipe(Effect.provide(layer)),
      );

      expect(exit._tag).toBe("Failure");
      const cause = exit._tag === "Failure" ? String(exit.cause) : "";
      expect(cause).toContain("line 1");
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(layer)));
    }
  });
});
