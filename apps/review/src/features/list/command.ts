import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { Message } from "../../message";

const SETTLE_DELAY_MS = 600;

/**
 * Long enough to swallow a double tap, short enough that a reviewer who read the next finding never waits.
 */
export const SettleSelection = Command.define("SettleSelection", {
  args: { version: S.Number },
  messages: [Message.SettledSelection],
  execute: ({ version }) => Effect.sleep(SETTLE_DELAY_MS).pipe(Effect.as(Message.SettledSelection({ version }))),
});
