import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer } from "effect";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { AcceptanceRecord, acceptanceKey } from "../../domain/acceptance.js";
import { Fingerprint, FindingSource } from "../../domain/fingerprint.js";
import {
  AcceptanceStore,
  parseAcceptances,
  reconcileAcceptanceRecords,
  serializeAcceptances,
} from "./acceptance-store.js";

const source = new FindingSource({
  standardId: "data/bounded-query",
  standardRevision: 1,
  detectorId: "prisma/find-many",
  detectorVersion: 1,
  bindingId: "app-queries",
  bindingDigest: "binding-a",
});

function record(digest: string, overrides: Partial<ConstructorParameters<typeof AcceptanceRecord>[0]> = {}) {
  return new AcceptanceRecord({
    schemaVersion: 1,
    source,
    fingerprint: new Fingerprint({ scheme: "source-structure", version: 1, digest }),
    lineageKey: `query:${digest}`,
    reason: `Reason for ${digest}.`,
    authority: "agent",
    actor: "agent:test",
    acceptedAt: "2026-08-10T12:00:00.000Z",
    ...overrides,
  });
}

function current(value: AcceptanceRecord) {
  return { source: value.source, fingerprint: value.fingerprint };
}

function testLayer(cwd: string) {
  const TestEnv = Layer.succeed(
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
  return AcceptanceStore.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(TestEnv));
}

function cleanup(cwd: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
  });
}

describe("acceptance current-state reconciliation", () => {
  it("sorts records and rejects duplicate exact identities", () => {
    const a = record("a");
    const b = record("b");
    const serialized = serializeAcceptances([b, a]);
    expect(parseAcceptances(serialized).map((entry) => entry.fingerprint.digest)).toEqual(["a", "b"]);
    expect(() => parseAcceptances(`${JSON.stringify(a)}\n${JSON.stringify(a)}\n`)).toThrow("duplicate");
  });

  it("never prunes stale records from a partial view", () => {
    const visible = record("visible");
    const outside = record("outside");
    const result = reconcileAcceptanceRecords([outside, visible], {
      scope: "partial",
      current: [current(visible)],
    });
    expect(result.records).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it("prunes stale records from a complete view", () => {
    const visible = record("visible");
    const stale = record("stale");
    const result = reconcileAcceptanceRecords([stale, visible], {
      scope: "complete",
      current: [current(visible)],
    });
    expect(result.records).toEqual([visible]);
    expect(result.removed).toEqual([stale]);
  });

  it("replaces stale evidence in the same explicit lineage", () => {
    const prior = record("prior", { lineageKey: "query:list-users" });
    const next = record("next", { lineageKey: "query:list-users", reason: "Reviewed the new limit." });
    const result = reconcileAcceptanceRecords([prior], {
      scope: "partial",
      current: [current(next)],
      accepted: [next],
    });
    expect(result.records).toEqual([next]);
    expect(result.removed).toEqual([prior]);
  });

  it("rejects an acceptance outside the checked view", () => {
    expect(() =>
      reconcileAcceptanceRecords([], { scope: "partial", current: [], accepted: [record("unknown")] }),
    ).toThrow("must identify a finding");
  });
});

describe("AcceptanceStore", () => {
  it("treats a missing file as empty and rewrites sorted current state", async () => {
    const cwd = join(tmpdir(), `agentlint-acceptance-${randomUUID()}`);
    const layer = testLayer(cwd);
    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* AcceptanceStore;
          const empty = yield* store.read();
          const b = record("b");
          const a = record("a");
          yield* store.write([b, a]);
          const saved = yield* store.read();
          return { empty, saved, a, b };
        }).pipe(Effect.provide(layer)),
      );
      expect(result.empty.records).toEqual([]);
      expect(result.saved.records).toEqual([result.a, result.b]);
      expect(result.saved.byKey.get(acceptanceKey(result.a))).toEqual(result.a);
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(layer)));
    }
  });

  it("reports malformed record line numbers", async () => {
    const cwd = join(tmpdir(), `agentlint-acceptance-${randomUUID()}`);
    const layer = testLayer(cwd);
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
          yield* fs.writeFileString(join(cwd, ".agentlint", "acceptances.jsonl"), '\n{"bad":true}\n');
        }).pipe(Effect.provide(layer)),
      );
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const store = yield* AcceptanceStore;
          return yield* store.read();
        }).pipe(Effect.provide(layer)),
      );
      expect(exit._tag).toBe("Failure");
      expect(exit._tag === "Failure" ? String(exit.cause) : "").toContain("line 2");
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(layer)));
    }
  });
});
