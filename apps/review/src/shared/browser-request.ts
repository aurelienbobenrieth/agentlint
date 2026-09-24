import { Effect, Schema as S } from "effect";

import { ReviewActionResult } from "@aurelienbbn/agentlint/contract";

export class BrowserRequestError extends S.TaggedError<BrowserRequestError>()("BrowserRequestError", {
  operation: S.String,
  detail: S.String,
  cause: S.optional(S.Defect()),
}) {
  override get message(): string {
    return `${this.operation}: ${this.detail}`;
  }
}

export const errorMessage = (value: { readonly message: string }): string => value.message;

const failure = ({ operation, cause }: { readonly operation: string; readonly cause: unknown }): BrowserRequestError =>
  new BrowserRequestError({
    operation,
    detail: S.is(S.instanceOf(Error))(cause) ? cause.message : "Unknown browser request failure",
    cause,
  });

/**
 * Local review requests must settle so failed connections release pending UI state.
 */
export const fetchReview = ({
  url,
  init,
}: {
  readonly url: string;
  readonly init?: RequestInit;
}): Effect.Effect<Response, BrowserRequestError> =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        ...init,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000), ...(init?.signal ? [init.signal] : [])]),
      }),
    catch: (cause) =>
      new BrowserRequestError({
        operation: "Review request failed",
        detail: S.is(S.instanceOf(Error))(cause) ? cause.message : "Unknown browser request failure",
        cause,
      }),
  });

/**
 * Every POST declares a JSON body; the local server rejects anything else.
 */
export const postJson = ({
  url,
  body,
}: {
  readonly url: string;
  readonly body: string;
}): Effect.Effect<Response, BrowserRequestError> =>
  fetchReview({ url, init: { method: "POST", headers: { "content-type": "application/json" }, body } });

export const responseJson = (response: Response): Effect.Effect<unknown, BrowserRequestError> =>
  Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) => failure({ operation: "Invalid review response", cause }),
  });

export const browserOperation = <A>({
  operation,
  execute,
}: {
  readonly operation: string;
  readonly execute: () => A;
}): Effect.Effect<A, BrowserRequestError> =>
  Effect.try({ try: execute, catch: (cause) => failure({ operation, cause }) });

const decodeActionResult = S.decodeUnknownEffect(ReviewActionResult);

/**
 * Server bodies are `{ ok, message }`; anything else falls back to a caller-provided message.
 */
export const responseMessage = ({
  response,
  fallback,
}: {
  readonly response: Response;
  readonly fallback: string;
}): Effect.Effect<string> =>
  responseJson(response).pipe(
    Effect.flatMap(decodeActionResult),
    Effect.map((result) => result.message),
    Effect.orElseSucceed(() => fallback),
  );
