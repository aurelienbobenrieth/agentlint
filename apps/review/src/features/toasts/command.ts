import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { Message } from "../../message";

export const ExpireToast = Command.define("ExpireToast", {
  args: { id: S.Number, delayMs: S.Number },
  messages: [Message.ExpiredToast],
  execute: ({ id, delayMs }) => Effect.sleep(delayMs).pipe(Effect.as(Message.ExpiredToast({ id }))),
});

export const RemoveToast = Command.define("RemoveToast", {
  args: { id: S.Number },
  messages: [Message.RemovedToast],
  execute: ({ id }) => Effect.sleep(180).pipe(Effect.as(Message.RemovedToast({ id }))),
});
