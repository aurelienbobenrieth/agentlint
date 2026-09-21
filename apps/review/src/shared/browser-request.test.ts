import { Effect } from "effect";
import { expect, it } from "@effect/vitest";
import { fetchReview, responseJson } from "./browser-request";

it.effect("exposes connection failures in the recoverable error channel", () =>
  Effect.gen(function* () {
    const result = yield* fetchReview({ url: "http://[" }).pipe(
      Effect.map(() => "unexpected success"),
      Effect.catch((error) => Effect.succeed(error._tag)),
    );
    expect(result).toBe("BrowserRequestError");
  }),
);

it.effect("exposes malformed JSON in the recoverable error channel", () =>
  Effect.gen(function* () {
    const result = yield* responseJson(new Response("not JSON")).pipe(
      Effect.catch((error) => Effect.succeed({ tag: error._tag, operation: error.operation })),
    );
    expect(result).toEqual({ tag: "BrowserRequestError", operation: "Invalid review response" });
  }),
);

it.effect("reads valid response bodies", () =>
  Effect.gen(function* () {
    expect(yield* responseJson(new Response('{"ok":true}'))).toEqual({ ok: true });
  }),
);
