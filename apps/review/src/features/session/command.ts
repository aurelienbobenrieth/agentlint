import {
  fetchReview,
  postJson,
  responseJson,
  responseMessage,
  BrowserRequestError,
  browserOperation,
  errorMessage,
} from "../../shared/browser-request";
import { Effect, Option, Schema as S } from "effect";
import { Command } from "foldkit";

import { ReviewProgress, ReviewSessionRequest, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import { PersistedReview } from "../../shared/model";
import { markDirty } from "../../shared/dirty-flag";

const decodeState = S.decodeUnknownEffect(ReviewStatePayload);
const decodeProgress = S.decodeUnknownEffect(ReviewProgress);
const encodeSessionRequest = S.encodeSync(S.fromJsonString(ReviewSessionRequest));
const PageLocation = S.Struct({ search: S.String, pathname: S.String });

/**
 * A first scan of a large repository takes a while; the progress poll shows it is alive, so only a stalled server
 * should end the wait.
 */
const STATE_TIMEOUT_MS = 10 * 60_000;
const PROGRESS_INTERVAL_MS = 400;

/**
 * A detached artifact embeds its state in the page. No review server stands behind such a page.
 */
export const hasEmbeddedState = (): boolean => Reflect.get(window, "__AGENTLINT_REVIEW__") !== undefined;

/**
 * Embedded state (detached artifacts) wins over the live `/api/state` endpoint.
 */
export const fetchState = Effect.gen(function* () {
  const embedded = Reflect.get(window, "__AGENTLINT_REVIEW__");
  if (embedded !== undefined) {
    return yield* decodeState(embedded);
  }

  const response = yield* fetchReview({ url: "/api/state", timeoutMs: STATE_TIMEOUT_MS });
  if (!response.ok) {
    const detail = yield* responseMessage({ response, fallback: `HTTP ${response.status}` });
    return yield* Effect.fail(new BrowserRequestError({ operation: "Load rejected", detail }));
  }
  const body = yield* responseJson(response);
  return yield* decodeState(body);
});

/**
 * Trade the link's one-time token for the session cookie, then drop it from the address bar and history. Following the
 * link only loads this page, so a prefetch cannot spend the token; a reload finds the cookie already set.
 */
const signIn = Effect.gen(function* () {
  const location = Reflect.get(window, "location");
  if (!S.is(PageLocation)(location)) return;
  const token = new URLSearchParams(location.search).get("token");
  if (token === null) return;
  const response = yield* postJson({ url: "/api/session", body: encodeSessionRequest({ token }) });
  yield* browserOperation({
    operation: "Clear the review link",
    execute: () => history.replaceState(history.state, "", location.pathname),
  }).pipe(Effect.ignore);
  if (!response.ok) {
    const detail = yield* responseMessage({ response, fallback: `HTTP ${response.status}` });
    return yield* Effect.fail(new BrowserRequestError({ operation: "Sign-in rejected", detail }));
  }
});

/**
 * Ask how far the server's scan got. Any failure answers `null`: the page keeps waiting for the state either way.
 */
export const PollProgress = Command.define("PollProgress", {
  messages: [Message.ReceivedProgress],
  execute: Effect.gen(function* () {
    yield* Effect.sleep(PROGRESS_INTERVAL_MS);
    const response = yield* fetchReview({ url: "/api/progress" });
    if (!response.ok) return Message.ReceivedProgress({ progress: null });
    const progress = yield* responseJson(response).pipe(Effect.flatMap(decodeProgress));
    return Message.ReceivedProgress({ progress });
  }).pipe(Effect.catch(() => Effect.succeed(Message.ReceivedProgress({ progress: null })))),
});

export const reviewStorageKey = (state: ReviewStatePayload): string =>
  `agentlint:review:v2:${encodeURIComponent(state.project)}:${encodeURIComponent(state.base)}:${state.mode}:${state.transport}${state.transport === "detached" ? `:${encodeURIComponent(state.generatedAt)}` : ""}`;

export interface SavedReview {
  readonly saved: PersistedReview | null;
  /**
   * Something was stored but this build cannot read it: corrupt, or written under another schema version.
   */
  readonly unreadable: boolean;
}

const decodePersistedReview = S.decodeUnknownOption(S.fromJsonString(PersistedReview));

/**
 * Corrupt browser state is reported through the unreadable flag and never restored.
 */
export const decodeSavedReview = (value: string | null): SavedReview =>
  value === null
    ? { saved: null, unreadable: false }
    : Option.match(decodePersistedReview(value), {
        onNone: () => ({ saved: null, unreadable: true }),
        onSome: (saved) => ({ saved, unreadable: false }),
      });

/**
 * An unreadable blob moves to `<key>:bak` so the next save cannot overwrite decisions nobody exported. A store that
 * throws (storage disabled, quota exceeded on the backup) must not block the review, so it opens without saved state.
 */
export const readSavedReview = (
  state: ReviewStatePayload,
): Effect.Effect<SavedReview & { readonly error: string | null }> =>
  browserOperation({
    operation: "Load saved review",
    execute: () => {
      const key = reviewStorageKey(state);
      const value = localStorage.getItem(key);
      const result = decodeSavedReview(value);
      if (value !== null && result.unreadable) {
        localStorage.setItem(`${key}:bak`, value);
        localStorage.removeItem(key);
      }
      return { ...result, error: null };
    },
  }).pipe(Effect.catch((error) => Effect.succeed({ saved: null, unreadable: false, error: error.detail })));

export const LoadReview = Command.define("LoadReview", {
  messages: [Message.LoadedState, Message.FailedLoadState],
  execute: signIn.pipe(
    Effect.andThen(fetchState),
    Effect.flatMap((state) =>
      readSavedReview(state).pipe(
        Effect.map(({ saved, unreadable, error }) =>
          Message.LoadedState({ state, saved, savedUnreadable: unreadable, savedError: error }),
        ),
      ),
    ),
    Effect.catch((error) => Effect.succeed(Message.FailedLoadState({ message: errorMessage(error) }))),
  ),
});

/**
 * `dirty` is decided by `update`. The flag is raised before the write so a failed save still warns on leave.
 */
export const PersistReview = Command.define("PersistReview", {
  args: { key: S.String, content: S.String, dirty: S.Boolean },
  messages: [Message.CompletedPersistence, Message.FailedPersistence],
  execute: ({ key, content, dirty }) =>
    browserOperation({
      operation: "Save review locally",
      execute: () => {
        markDirty(dirty);
        localStorage.setItem(key, content);
        return Message.CompletedPersistence();
      },
    }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedPersistence({ message: errorMessage(error) })))),
});

export const MarkDirty = Command.define("MarkDirty", {
  args: { dirty: S.Boolean },
  messages: [Message.PerformedDomEffect],
  execute: ({ dirty }) =>
    Effect.sync(() => {
      markDirty(dirty);
      return Message.PerformedDomEffect();
    }),
});

const PERSIST_DELAY_MS = 400;

/**
 * Trailing debounce for text edits. Stale timers resolve too; update ignores every version but the latest.
 */
export const DelayPersist = Command.define("DelayPersist", {
  args: { version: S.Number },
  messages: [Message.ElapsedPersistDelay],
  execute: ({ version }) => Effect.sleep(PERSIST_DELAY_MS).pipe(Effect.as(Message.ElapsedPersistDelay({ version }))),
});
