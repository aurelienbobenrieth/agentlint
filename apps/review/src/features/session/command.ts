import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import { PersistedReview } from "../../model";

const errorMessage = (value: unknown): string =>
  value instanceof Error ? value.message : "The review service returned an unexpected response.";

const decodeState = S.decodeUnknownEffect(ReviewStatePayload);

/** Embedded state (detached artifacts) wins over the live `/api/state` endpoint. */
export const fetchState = Effect.gen(function* () {
  const embedded = Reflect.get(window, "__AGENTLINT_REVIEW__");
  if (embedded !== undefined) {
    return yield* decodeState(embedded);
  }

  const response = yield* Effect.promise(() => fetch("/api/state"));
  if (!response.ok) {
    return yield* Effect.fail(new Error(`Could not load the review (${response.status}).`));
  }
  const body = yield* Effect.promise(() => response.json());
  return yield* decodeState(body);
});

export const reviewStorageKey = (state: ReviewStatePayload): string =>
  `agentlint:review:v2:${encodeURIComponent(state.project)}:${encodeURIComponent(state.base)}:${state.mode}:${state.transport}${state.transport === "detached" ? `:${encodeURIComponent(state.generatedAt)}` : ""}`;

const readSavedReview = (state: ReviewStatePayload) =>
  Effect.sync(() => {
    const value = localStorage.getItem(reviewStorageKey(state));
    if (value === null) return null;
    try {
      return S.decodeUnknownSync(S.fromJsonString(PersistedReview))(value);
    } catch {
      return null;
    }
  });

export const LoadReview = Command.define("LoadReview", {
  messages: [Message.LoadedState, Message.FailedLoadState],
  execute: fetchState.pipe(
    Effect.flatMap((state) =>
      readSavedReview(state).pipe(Effect.map((saved) => Message.LoadedState({ state, saved }))),
    ),
    Effect.catch((error) => Effect.succeed(Message.FailedLoadState({ message: errorMessage(error) }))),
  ),
});

export const PersistReview = Command.define("PersistReview", {
  args: { key: S.String, content: S.String },
  messages: [Message.CompletedPersistence, Message.FailedPersistence],
  execute: ({ key, content }) =>
    Effect.sync(() => {
      localStorage.setItem(key, content);
      Reflect.set(window, "__AGENTLINT_REVIEW_DIRTY__", true);
      return Message.CompletedPersistence();
    }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedPersistence({ message: errorMessage(error) })))),
});

export const PERSIST_DELAY_MS = 400;

/** Trailing debounce for text edits. Stale timers resolve too; update ignores every version but the latest. */
export const DelayPersist = Command.define("DelayPersist", {
  args: { version: S.Number },
  messages: [Message.ElapsedPersistDelay],
  execute: ({ version }) => Effect.sleep(PERSIST_DELAY_MS).pipe(Effect.as(Message.ElapsedPersistDelay({ version }))),
});
