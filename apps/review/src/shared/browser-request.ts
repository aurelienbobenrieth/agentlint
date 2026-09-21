import { Effect, Schema as S } from "effect";

import { ReviewActionResult } from "@aurelienbbn/agentlint/contract";

export class BrowserRequestError extends S.TaggedError<BrowserRequestError>()("BrowserRequestError", {
  operation: S.String,
  detail: S.String,
}) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

const failure =
  (operation: string) =>
  (cause: unknown): BrowserRequestError =>
    new BrowserRequestError({ operation, detail: cause instanceof Error ? cause.message : String(cause) });

export const errorMessage = (value: unknown): string =>
  value instanceof Error ? value.message : "The review service returned an unexpected response.";

/** Local review requests must settle so failed connections release pending UI state. */
export const fetchReview = (url: string, init?: RequestInit): Effect.Effect<Response, BrowserRequestError> =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000), ...(init?.signal ? [init.signal] : [])]),
      }),
    catch: failure("Review request failed"),
  });

/** Every POST declares a JSON body; the local server rejects anything else. */
export const postJson = (url: string, body: string): Effect.Effect<Response, BrowserRequestError> =>
  fetchReview(url, { method: "POST", headers: { "content-type": "application/json" }, body });

export const responseJson = (response: Response): Effect.Effect<unknown, BrowserRequestError> =>
  Effect.tryPromise({ try: () => response.json(), catch: failure("Invalid review response") });

export const browserOperation = <A>(operation: string, execute: () => A): Effect.Effect<A, BrowserRequestError> =>
  Effect.try({ try: execute, catch: failure(operation) });

const decodeActionResult = S.decodeUnknownEffect(ReviewActionResult);

/** Server bodies are `{ ok, message }`; anything else falls back to a caller-provided message. */
export const responseMessage = (response: Response, fallback: string): Effect.Effect<string> =>
  responseJson(response).pipe(
    Effect.flatMap(decodeActionResult),
    Effect.map((result) => result.message),
    Effect.orElseSucceed(() => fallback),
  );
