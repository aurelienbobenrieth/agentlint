import { Effect } from "effect";
import { expect, it } from "vitest";
import { fetchReview, responseJson } from "./browser-request";

it("exposes connection failures in the recoverable error channel", async () => {
  const result = await Effect.runPromise(
    fetchReview("http://[").pipe(
      Effect.map(() => "unexpected success"),
      Effect.catch((error) => Effect.succeed(error._tag)),
    ),
  );
  expect(result).toBe("BrowserRequestError");
});

it("exposes malformed JSON in the recoverable error channel", async () => {
  const result = await Effect.runPromise(
    responseJson(new Response("not JSON")).pipe(
      Effect.catch((error) => Effect.succeed({ tag: error._tag, operation: error.operation })),
    ),
  );
  expect(result).toEqual({ tag: "BrowserRequestError", operation: "Invalid review response" });
});

it("reads valid response bodies", async () => {
  await expect(Effect.runPromise(responseJson(new Response('{"ok":true}')))).resolves.toEqual({ ok: true });
});
