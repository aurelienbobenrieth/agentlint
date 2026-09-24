import { Effect } from "effect";
import { expect, it } from "@effect/vitest";
import { afterEach, vi } from "vitest";

import type { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { FinishReview } from "../finish/command";
import { LoadReview, readSavedReview, reviewStorageKey } from "./command";

const state = {
  project: "demo",
  base: "main",
  mode: "review",
  transport: "detached",
  generatedAt: "2026-08-10T00:00:00.000Z",
} as ReviewStatePayload;

const rejectingServer = (body: string) => {
  vi.stubGlobal("window", {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status: 409, headers: { "content-type": "application/json" } })),
  );
};

const storage = (overrides: Partial<Storage>): Storage =>
  ({
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    ...overrides,
  }) as Partial<Storage> as Storage;

afterEach(() => {
  vi.unstubAllGlobals();
});

it.effect("reports the server's message when loading is rejected", () =>
  Effect.gen(function* () {
    rejectingServer('{"ok":false,"message":"This review session has ended."}');
    expect(yield* LoadReview().effect).toMatchObject({
      _tag: "FailedLoadState",
      message: "Load rejected: This review session has ended.",
    });
    rejectingServer("<html>proxy error</html>");
    expect(yield* LoadReview().effect).toMatchObject({ _tag: "FailedLoadState", message: "Load rejected: HTTP 409" });
  }),
);

it.effect("reports the server's message when finishing is rejected", () =>
  Effect.gen(function* () {
    rejectingServer('{"ok":false,"message":"A decision is still being saved."}');
    expect(yield* FinishReview().effect).toMatchObject({
      _tag: "FailedFinish",
      message: "Finish rejected: A decision is still being saved.",
    });
  }),
);

it.effect("opens without saved state when the browser store throws", () =>
  Effect.gen(function* () {
    vi.stubGlobal(
      "localStorage",
      storage({
        getItem: () => {
          throw new Error("The operation is insecure.");
        },
      }),
    );
    expect(yield* readSavedReview(state)).toEqual({
      saved: null,
      unreadable: false,
      error: "The operation is insecure.",
    });

    const removed: Array<string> = [];
    vi.stubGlobal(
      "localStorage",
      storage({
        getItem: () => "{not json",
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: (key) => {
          removed.push(key);
        },
      }),
    );
    expect(yield* readSavedReview(state)).toEqual({ saved: null, unreadable: false, error: "QuotaExceededError" });
    // The corrupt blob stays where it was when its backup could not be written.
    expect(removed).toEqual([]);
  }),
);

it.effect("moves an unreadable saved review to its backup key", () =>
  Effect.gen(function* () {
    const written = new Map<string, string>();
    const removed: Array<string> = [];
    vi.stubGlobal(
      "localStorage",
      storage({
        getItem: () => "{not json",
        setItem: (key, value) => {
          written.set(key, value);
        },
        removeItem: (key) => {
          removed.push(key);
        },
      }),
    );
    expect(yield* readSavedReview(state)).toEqual({ saved: null, unreadable: true, error: null });
    expect([...written]).toEqual([[`${reviewStorageKey(state)}:bak`, "{not json"]]);
    expect(removed).toEqual([reviewStorageKey(state)]);
  }),
);
