import { BrowserRequestError, errorMessage, postJson, responseMessage } from "../../shared/browser-request";
import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { ReviewActionRequest } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import { fetchState } from "../session/command";

const encodeActionRequest = S.encodeSync(S.fromJsonString(ReviewActionRequest));

/**
 * Attached sessions: post the decision, then refetch the server truth. Once the POST succeeded the decision is on disk,
 * so a failing refetch is reported as a stale screen, never as a failed decision.
 */
export const SubmitAction = Command.define("SubmitAction", {
  args: { request: ReviewActionRequest },
  messages: [Message.CompletedAction, Message.RecordedActionRefreshFailed, Message.FailedAction],
  execute: Effect.fn("SubmitAction.execute")(function* ({ request }) {
    return yield* Effect.gen(function* () {
      const response = yield* postJson({ url: "/api/action", body: encodeActionRequest(request) });
      const message = yield* responseMessage({ response, fallback: `Action failed (${response.status}).` });
      if (!response.ok)
        return yield* Effect.fail(new BrowserRequestError({ operation: "Decision rejected", detail: message }));
      return yield* fetchState.pipe(
        Effect.map((state) => Message.CompletedAction({ findingId: request.findingId, state, message })),
        Effect.catch((error) =>
          Effect.succeed(
            Message.RecordedActionRefreshFailed({ findingId: request.findingId, message: errorMessage(error) }),
          ),
        ),
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedAction({ findingId: request.findingId, message: errorMessage(error) })),
      ),
    );
  }),
});
