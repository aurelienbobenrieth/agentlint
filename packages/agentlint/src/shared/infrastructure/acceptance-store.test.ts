import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Env } from "../../config/env.js";
import { AcceptanceRecord, acceptanceKey } from "../../domain/acceptance.js";
import { Fingerprint, FindingSource } from "../../domain/fingerprint.js";
import { encodeJson } from "./json.js";
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

function record({
  digest,
  overrides = {},
}: {
  readonly digest: string;
  readonly overrides?: Partial<ConstructorParameters<typeof AcceptanceRecord>[0]>;
}) {
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
  return AcceptanceStore.layer.pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, TestEnv)));
}

const cleanup = Effect.fn("cleanup")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
});

describe("acceptance current-state reconciliation", () => {
  it.effect("preserves the previous file and releases the lock when atomic replacement fails", () =>
    Effect.gen(function* () {
      const cwd = join(tmpdir(), `agentlint-acceptance-${randomUUID()}`);
      const layer = testLayer(cwd);
      yield* Effect.gen(function* () {
        const store = yield* AcceptanceStore;
        const fs = yield* FileSystem.FileSystem;
        yield* store.write([record({ digest: "original" })]);
        const broken = FileSystem.makeNoop({
          ...fs,
          rename: () =>
            Effect.fail(
              PlatformError.badArgument({
                module: "FileSystem",
                method: "rename",
                description: "simulated replacement failure",
              }),
            ),
        });
        const failed = yield* Effect.flatMap(AcceptanceStore, (other) =>
          other.write([record({ digest: "replacement" })]),
        ).pipe(
          Effect.provide(Layer.fresh(AcceptanceStore.layer)),
          Effect.provideService(FileSystem.FileSystem, broken),
          Effect.result,
        );
        expect(failed._tag).toBe("Failure");
        expect((yield* store.read()).records).toEqual([record({ digest: "original" })]);
        expect(yield* fs.readDirectory(join(cwd, ".agentlint"))).toEqual(["acceptances.jsonl"]);
      }).pipe(Effect.provide(layer), Effect.ensuring(cleanup(cwd).pipe(Effect.provide(layer))));
    }),
  );

  it.live("never steals a lock whose owner may still write", () =>
    Effect.gen(function* () {
      const cwd = join(tmpdir(), `agentlint-acceptance-${randomUUID()}`);
      const layer = testLayer(cwd);
      const lock = join(cwd, ".agentlint", "acceptances.lock");
      const write = Effect.flatMap(AcceptanceStore, (store) => store.write([record({ digest: "kept" })]));
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
        yield* fs.writeFileString(lock, "another-owner\n");
        const blocked = yield* Effect.flip(write);
        expect(blocked.message).toContain("locked");
        expect(yield* fs.exists(lock)).toBe(true);
      }).pipe(Effect.provide(layer), Effect.ensuring(cleanup(cwd).pipe(Effect.provide(layer))));
    }),
  );

  it("sorts records and rejects duplicate exact identities", () => {
    const a = record({ digest: "a" });
    const b = record({ digest: "b" });
    const serialized = serializeAcceptances([b, a]);
    expect(parseAcceptances(serialized).map((entry) => entry.fingerprint.digest)).toEqual(["a", "b"]);
    expect(() => parseAcceptances(`${encodeJson(a)}\n${encodeJson(a)}\n`)).toThrow("duplicate");
  });

  it("never prunes stale records from a partial view", () => {
    const visible = record({ digest: "visible" });
    const outside = record({ digest: "outside" });
    const result = reconcileAcceptanceRecords({
      existing: [outside, visible],
      input: {
        stale: "none",
        current: [current(visible)],
      },
    });
    expect(result.records).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it("prunes stale records from a complete view", () => {
    const visible = record({ digest: "visible" });
    const stale = record({ digest: "stale" });
    const result = reconcileAcceptanceRecords({
      existing: [stale, visible],
      input: {
        stale: "all",
        current: [current(visible)],
      },
    });
    expect(result.records).toEqual([visible]);
    expect(result.removed).toEqual([stale]);
  });

  it("prunes only stale state records from a complete view against another base", () => {
    const staleState = record({ digest: "state" });
    const staleChange = record({
      digest: "change",
      overrides: { fingerprint: new Fingerprint({ scheme: "git-change", version: 2, digest: "change" }) },
    });
    const result = reconcileAcceptanceRecords({
      existing: [staleState, staleChange],
      input: { stale: "state", current: [] },
    });
    expect(result.records).toEqual([staleChange]);
    expect(result.removed).toEqual([staleState]);
  });

  it("preserves other identities in the same lineage during partial updates", () => {
    const prior = record({ digest: "prior", overrides: { lineageKey: "query:list-users" } });
    const next = record({
      digest: "next",
      overrides: { lineageKey: "query:list-users", reason: "Reviewed the new limit." },
    });
    const result = reconcileAcceptanceRecords({
      existing: [prior],
      input: {
        stale: "none",
        current: [current(next)],
        accepted: [next],
      },
    });
    expect(result.records).toEqual([next, prior]);
    expect(result.removed).toEqual([]);
  });

  it("rejects an acceptance outside the checked view", () => {
    expect(() =>
      reconcileAcceptanceRecords({
        existing: [],
        input: { stale: "none", current: [], accepted: [record({ digest: "unknown" })] },
      }),
    ).toThrow("must identify a finding");
  });
});

describe("decisions stored under a legacy fingerprint", () => {
  const legacy = new Fingerprint({ scheme: "source-structure", version: 3, digest: "legacy-a" });
  const now = new Fingerprint({ scheme: "source-structure", version: 4, digest: "current-a" });
  const finding = { source, fingerprint: now, legacyFingerprints: [legacy], lineageKey: "query:current" };
  const stored = record({ digest: "legacy-a", overrides: { fingerprint: legacy } });

  it("moves a matching record to the current fingerprint and lineage, keeping the decision", () => {
    const result = reconcileAcceptanceRecords({ existing: [stored], input: { stale: "none", current: [finding] } });
    expect(result.records).toEqual([
      new AcceptanceRecord({ ...stored, fingerprint: now, lineageKey: "query:current" }),
    ]);
    expect([result.migrated.length, result.removed]).toEqual([1, []]);
  });

  it("keeps a decision already stored under the current fingerprint and drops the legacy copy", () => {
    const decided = record({ digest: "current-a", overrides: { fingerprint: now, reason: "Decided on v4." } });
    const result = reconcileAcceptanceRecords({
      existing: [stored, decided],
      input: { stale: "all", current: [finding] },
    });
    expect(result.records.map((kept) => kept.reason)).toEqual(["Decided on v4."]);
  });

  it("revokes a legacy decision the review showed", () => {
    const result = reconcileAcceptanceRecords({
      existing: [stored],
      input: {
        stale: "none",
        current: [finding],
        revoked: [{ ...finding, expectedAcceptedAt: stored.acceptedAt, expectedReason: stored.reason }],
      },
    });
    expect(result.records).toEqual([]);
  });

  it("keeps an unmatched legacy record in a partial view and removes it from a complete one", () => {
    const other = { ...finding, legacyFingerprints: [new Fingerprint({ ...legacy, digest: "legacy-b" })] };
    expect(
      reconcileAcceptanceRecords({ existing: [stored], input: { stale: "none", current: [other] } }).records,
    ).toEqual([stored]);
    expect(
      reconcileAcceptanceRecords({ existing: [stored], input: { stale: "all", current: [other] } }).removed,
    ).toEqual([stored]);
  });
});

describe("AcceptanceStore", () => {
  it.live("serializes concurrent read-modify-write transactions across service instances", () => {
    const cwd = join(tmpdir(), `agentlint-concurrent-${randomUUID()}`);
    return Effect.gen(function* () {
      yield* Effect.forEach(
        Array.from({ length: 8 }, (_, index) => index),
        (index) => {
          const accepted = record({ digest: String(index) });
          return Effect.flatMap(AcceptanceStore, (store) =>
            store.reconcile({ stale: "none", current: [current(accepted)], accepted: [accepted] }),
          ).pipe(Effect.provide(testLayer(cwd)));
        },
        { concurrency: "unbounded" },
      );
      const result = yield* Effect.flatMap(AcceptanceStore, (store) => store.read()).pipe(
        Effect.provide(testLayer(cwd)),
      );
      expect(result.records).toHaveLength(8);
    }).pipe(Effect.ensuring(cleanup(cwd).pipe(Effect.provide(NodeServices.layer))));
  });

  it("rejects revocations if the reviewed decision was replaced", () => {
    const previous = record({ digest: "a" });
    const replaced = record({ digest: "a", overrides: { reason: "A newer decision." } });
    expect(() =>
      reconcileAcceptanceRecords({
        existing: [replaced],
        input: {
          stale: "none",
          current: [current(previous)],
          revoked: [{ ...current(previous), expectedAcceptedAt: previous.acceptedAt, expectedReason: previous.reason }],
        },
      }),
    ).toThrow("changed after review");
    expect(
      reconcileAcceptanceRecords({
        existing: [previous],
        input: {
          stale: "none",
          current: [current(previous)],
          revoked: [{ ...current(previous), expectedAcceptedAt: previous.acceptedAt, expectedReason: previous.reason }],
        },
      }).records,
    ).toEqual([]);
  });
  it.effect("treats a missing file as empty and rewrites sorted current state", () =>
    Effect.gen(function* () {
      const cwd = join(tmpdir(), `agentlint-acceptance-${randomUUID()}`);
      const layer = testLayer(cwd);
      yield* Effect.gen(function* () {
        const result = yield* Effect.gen(function* () {
          const store = yield* AcceptanceStore;
          const empty = yield* store.read();
          const b = record({ digest: "b" });
          const a = record({ digest: "a" });
          yield* store.write([b, a]);
          const saved = yield* store.read();
          return { empty, saved, a, b };
        }).pipe(Effect.provide(layer));
        expect(result.empty.records).toEqual([]);
        expect(result.saved.records).toEqual([result.a, result.b]);
        expect(result.saved.byKey.get(acceptanceKey(result.a))).toEqual(result.a);
      }).pipe(Effect.ensuring(cleanup(cwd).pipe(Effect.provide(layer))));
    }),
  );

  it.effect("reports malformed record line numbers", () =>
    Effect.gen(function* () {
      const cwd = join(tmpdir(), `agentlint-acceptance-${randomUUID()}`);
      const layer = testLayer(cwd);
      yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(join(cwd, ".agentlint"), { recursive: true });
        yield* fs.writeFileString(join(cwd, ".agentlint", "acceptances.jsonl"), '\n{"bad":true}\n');
        const exit = yield* Effect.exit(
          Effect.gen(function* () {
            const store = yield* AcceptanceStore;
            return yield* store.read();
          }).pipe(Effect.provide(layer)),
        );
        expect(exit._tag).toBe("Failure");
        expect(exit._tag === "Failure" ? String(exit.cause) : "").toContain("line 2");
      }).pipe(Effect.provide(layer), Effect.ensuring(cleanup(cwd).pipe(Effect.provide(layer))));
    }),
  );
});
