import { postJson, responseMessage } from "../../shared/browser-request";
import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { EditorApplicationId, ReviewOpenRequest } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import { ExportKind } from "../../shared/model";

const encodeOpenRequest = S.encodeSync(S.fromJsonString(ReviewOpenRequest));

class ClipboardWriteError extends S.TaggedError<ClipboardWriteError>()("review/ClipboardWriteError", {
  cause: S.Defect(),
}) {}

export const CopyText = Command.define("CopyText", {
  args: { content: S.String, successMessage: S.optional(S.String), kind: S.optional(ExportKind) },
  messages: [Message.CompletedUtility, Message.ExportedOutput],
  execute: ({ content, successMessage, kind }) =>
    Effect.tryPromise({
      try: async () => {
        try {
          await navigator.clipboard.writeText(content);
          return;
        } catch {
          const textarea = document.createElement("textarea");
          textarea.value = content;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.append(textarea);
          const copied = (() => {
            try {
              textarea.select();
              return document.execCommand("copy");
            } finally {
              textarea.remove();
            }
          })();
          if (!copied) throw new Error("Browser clipboard access is unavailable.");
        }
      },
      catch: (cause) => new ClipboardWriteError({ cause }),
    }).pipe(
      Effect.as(
        kind === undefined
          ? Message.CompletedUtility({ message: successMessage ?? "Agent instructions copied.", tone: "success" })
          : Message.ExportedOutput({ kind, message: successMessage ?? "Agent instructions copied." }),
      ),
      Effect.catch(() =>
        Effect.succeed(
          Message.CompletedUtility({ message: "Copy failed. Select the text and copy it manually.", tone: "danger" }),
        ),
      ),
    ),
});

export const OpenEditor = Command.define("OpenEditor", {
  args: { findingId: S.String, application: EditorApplicationId },
  messages: [Message.CompletedUtility],
  execute: Effect.fn("OpenEditor.execute")(function* ({ findingId, application }) {
    return yield* Effect.gen(function* () {
      const response = yield* postJson({ url: "/api/open", body: encodeOpenRequest({ findingId, application }) });
      const message = yield* responseMessage({
        response,
        fallback: response.ok ? "Opening the finding…" : "Could not open the finding.",
      });
      return Message.CompletedUtility({ message, tone: response.ok ? "success" : "danger" });
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.CompletedUtility({ message: "Could not reach the local editor service.", tone: "danger" }),
        ),
      ),
    );
  }),
});
