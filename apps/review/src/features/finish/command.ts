import { BrowserRequestError, errorMessage, postJson, responseJson } from "../../shared/browser-request";
import { Clock, Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { ReviewFinishResult } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import { ExportKind } from "../../model";
import { hasEmbeddedState } from "../session/command";

const decodeFinishResult = S.decodeUnknownEffect(ReviewFinishResult);

export const FinishReview = Command.define("FinishReview", {
  messages: [Message.CompletedFinish, Message.FailedFinish],
  execute: Effect.gen(function* () {
    const response = yield* postJson("/api/finish", "{}");
    if (!response.ok) {
      return yield* Effect.fail(
        new BrowserRequestError({ operation: "Finish rejected", detail: `HTTP ${response.status}` }),
      );
    }
    const result = yield* responseJson(response).pipe(Effect.flatMap(decodeFinishResult));
    return Message.CompletedFinish({
      summary: result.summary,
      feedback: result.feedback,
      acceptanceOutput: "",
    });
  }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedFinish({ message: errorMessage(error) })))),
});

/**
 * Detached reviews finish in the browser; the server call only lets a local host shut down. A page that embeds its
 * state is a standalone artifact: whatever origin serves it is not a review server, so nothing is posted there.
 */
export const PrepareDetachedFinish = Command.define("PrepareDetachedFinish", {
  messages: [Message.PreparedDetachedFinish],
  execute: Effect.gen(function* () {
    const milliseconds = yield* Clock.currentTimeMillis;
    if (!hasEmbeddedState()) yield* postJson("/api/finish", "{}").pipe(Effect.ignore);
    return Message.PreparedDetachedFinish({ acceptedAt: new Date(milliseconds).toISOString() });
  }),
});

/**
 * With a `kind`, success is reported as `ExportedOutput` so the finished screen knows what is still owed.
 */
export const DownloadText = Command.define("DownloadText", {
  args: { content: S.String, filename: S.String, kind: S.optional(ExportKind) },
  messages: [Message.CompletedUtility, Message.ExportedOutput],
  execute: ({ content, filename, kind }) =>
    Effect.sync(() => {
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      const message = `${filename} downloaded.`;
      return kind === undefined
        ? Message.CompletedUtility({ message, tone: "success" })
        : Message.ExportedOutput({ kind, message });
    }),
});
