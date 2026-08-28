import { Clock, Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { ReviewFinishResult } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";

const decodeFinishResult = S.decodeUnknownEffect(ReviewFinishResult);

const errorMessage = (value: unknown): string =>
  value instanceof Error ? value.message : "The review service returned an unexpected response.";

export const FinishReview = Command.define("FinishReview", {
  messages: [Message.CompletedFinish, Message.FailedFinish],
  execute: Effect.gen(function* () {
    const response = yield* Effect.promise(() => fetch("/api/finish", { method: "POST" }));
    if (!response.ok) {
      return yield* Effect.fail(new Error(`Could not finish the review (${response.status}).`));
    }
    const result = yield* Effect.promise(() => response.json()).pipe(Effect.flatMap(decodeFinishResult));
    Reflect.set(window, "__AGENTLINT_REVIEW_DIRTY__", false);
    return Message.CompletedFinish({
      summary: result.summary,
      feedback: result.feedback,
      acceptanceOutput: result.acceptanceOutput,
    });
  }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedFinish({ message: errorMessage(error) })))),
});

/** Detached reviews finish in the browser; the server call only lets a local host shut down. */
export const PrepareDetachedFinish = Command.define("PrepareDetachedFinish", {
  messages: [Message.PreparedDetachedFinish],
  execute: Effect.gen(function* () {
    const milliseconds = yield* Clock.currentTimeMillis;
    yield* Effect.promise(() => fetch("/api/finish", { method: "POST" })).pipe(Effect.ignore);
    Reflect.set(window, "__AGENTLINT_REVIEW_DIRTY__", false);
    return Message.PreparedDetachedFinish({ acceptedAt: new Date(milliseconds).toISOString() });
  }),
});

export const DownloadText = Command.define("DownloadText", {
  args: { content: S.String, filename: S.String },
  messages: [Message.CompletedUtility],
  execute: ({ content, filename }) =>
    Effect.sync(() => {
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      return Message.CompletedUtility({ message: `${filename} downloaded.`, tone: "success" });
    }),
});
