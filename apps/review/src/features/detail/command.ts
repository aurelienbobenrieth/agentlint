import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { EditorApplicationId, ReviewActionResult } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";

const decodeActionResult = S.decodeUnknownEffect(ReviewActionResult);

/** Server bodies are `{ ok, message }`; anything else falls back to a caller-provided message. */
export const responseMessage = (response: Response, fallback: string): Effect.Effect<string> =>
  Effect.promise(() => response.json()).pipe(
    Effect.flatMap(decodeActionResult),
    Effect.map((result) => result.message),
    Effect.orElseSucceed(() => fallback),
  );

export const CopyText = Command.define("CopyText", {
  args: { content: S.String, successMessage: S.optional(S.String) },
  messages: [Message.CompletedUtility],
  execute: ({ content, successMessage }) =>
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
      Effect.as(Message.CompletedUtility({ message: successMessage ?? "Agent instructions copied.", tone: "success" })),
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
      const response = yield* Effect.promise(() =>
        fetch("/api/open", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ findingId, application }),
        }),
      );
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
