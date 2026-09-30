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

const linkServer = (session: { readonly status: number; readonly body: string }) => {
  const requests: Array<readonly [string, string, string | null]> = [];
  const replaced: Array<string> = [];
  vi.stubGlobal("window", { location: { search: "?token=abc123", pathname: "/" } });
  vi.stubGlobal("history", { state: null, replaceState: (_: unknown, __: string, url: string) => replaced.push(url) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push([url, init?.method ?? "GET", typeof init?.body === "string" ? init.body : null]);
      return url === "/api/session"
        ? new Response(session.body, { status: session.status, headers: { "content-type": "application/json" } })
        : new Response('{"ok":false,"message":"stop here"}', { status: 409 });
    }),
  );
  return { requests, replaced };
};

it.effect("trades the link token for the session before loading, and drops it from the address bar", () =>
  Effect.gen(function* () {
    const server = linkServer({ status: 200, body: '{"ok":true,"message":"Signed in."}' });
    expect(yield* LoadReview().effect).toMatchObject({ _tag: "FailedLoadState", message: "Load rejected: stop here" });
    expect(server.requests).toEqual([
      ["/api/session", "POST", '{"token":"abc123"}'],
      ["/api/state", "GET", null],
    ]);
    expect(server.replaced).toEqual(["/"]);
  }),
);

it.effect("explains a link another browser already used, without asking for the state", () =>
  Effect.gen(function* () {
    const server = linkServer({
      status: 403,
      body: '{"ok":false,"message":"This review link was already opened in another browser."}',
    });
    expect(yield* LoadReview().effect).toMatchObject({
      _tag: "FailedLoadState",
      message: "Sign-in rejected: This review link was already opened in another browser.",
    });
    expect(server.requests.map(([url]) => url)).toEqual(["/api/session"]);
    expect(server.replaced).toEqual(["/"]);
  }),
);
