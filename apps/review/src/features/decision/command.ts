import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { ReviewActionRequest } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import { responseMessage } from "../detail/command";
import { fetchState } from "../session/command";

const encodeActionRequest = S.encodeSync(S.fromJsonString(ReviewActionRequest));

const errorMessage = (value: unknown): string =>
  value instanceof Error ? value.message : "The review service returned an unexpected response.";

/** Attached sessions: post the decision, then refetch the server truth. */
export const SubmitAction = Command.define("SubmitAction", {
  args: { request: ReviewActionRequest },
  messages: [Message.CompletedAction, Message.FailedAction],
  execute: ({ request }) =>
    Effect.gen(function* () {
      const response = yield* Effect.promise(() =>
        fetch("/api/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: encodeActionRequest(request),
        }),
      );
      const message = yield* responseMessage(response, `Action failed (${response.status}).`);
      if (!response.ok) return yield* Effect.fail(new Error(message));
      const state = yield* fetchState;
      return Message.CompletedAction({ findingId: request.findingId, state, message });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedAction({ findingId: request.findingId, message: errorMessage(error) })),
      ),
    ),
});
