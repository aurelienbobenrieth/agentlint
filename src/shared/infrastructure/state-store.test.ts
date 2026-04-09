import { Effect, HashSet, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { StateStore } from "./state-store.js";

const TestLayer = StateStore.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(Env.layer));

const run = <A>(effect: Effect.Effect<A, unknown, StateStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

describe("StateStore", () => {
  it("load returns empty set when file is missing", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* StateStore;
        yield* store.reset();
        const result = yield* store.load();
        expect(HashSet.size(result)).toBe(0);
      }),
    );
  });

  it("append and load round-trip", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* StateStore;
        yield* store.reset();
        yield* store.append(["abc1234", "def5678"]);
        const result = yield* store.load();
        expect(HashSet.size(result)).toBe(2);
        expect(HashSet.has(result, "abc1234")).toBe(true);
        expect(HashSet.has(result, "def5678")).toBe(true);
        yield* store.reset();
      }),
    );
  });

  it("append deduplicates", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* StateStore;
        yield* store.reset();
        yield* store.append(["abc1234"]);
        yield* store.append(["abc1234", "def5678"]);
        const result = yield* store.load();
        expect(HashSet.size(result)).toBe(2);
        expect(HashSet.has(result, "abc1234")).toBe(true);
        expect(HashSet.has(result, "def5678")).toBe(true);
        yield* store.reset();
      }),
    );
  });

  it("reset clears the state", async () => {
    await run(
      Effect.gen(function* () {
        const store = yield* StateStore;
        yield* store.append(["abc1234"]);
        yield* store.reset();
        const result = yield* store.load();
        expect(HashSet.size(result)).toBe(0);
      }),
    );
  });
});
