import { postJson, responseMessage } from "../../shared/browser-request";
import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { EditorApplicationId, ReviewOpenRequest } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import { ExportKind } from "../../model";

const encodeOpenRequest = S.encodeSync(S.fromJsonString(ReviewOpenRequest));

export const CopyText = Command.define("CopyText", {
  args: { content: S.String, successMessage: S.optional(S.String), kind: S.optional(ExportKind) },
  messages: [Message.CompletedUtility, Message.ExportedOutput],
  execute: ({ content, successMessage, kind }) =>
    Effect.tryPromise(async () => {
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
        let copied = false;
        try {
          textarea.select();
          copied = document.execCommand("copy");
        } finally {
          textarea.remove();
        }
        if (!copied) throw new Error("Browser clipboard access is unavailable.");
      }
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
  execute: ({ findingId, application }) =>
    Effect.gen(function* () {
      const response = yield* postJson("/api/open", encodeOpenRequest({ findingId, application }));
      const message = yield* responseMessage(
        response,
        response.ok ? "Opening the finding…" : "Could not open the finding.",
      );
      return Message.CompletedUtility({ message, tone: response.ok ? "success" : "danger" });
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.CompletedUtility({ message: "Could not reach the local editor service.", tone: "danger" }),
        ),
      ),
    ),
});
