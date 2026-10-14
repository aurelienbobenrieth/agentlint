import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { Message } from "../../message";

const SETTLE_DELAY_MS = 600;

export const RevealFinding = Command.define("RevealFinding", {
  args: { findingId: S.String },
  messages: [Message.PerformedDomEffect],
  execute: ({ findingId }) =>
    Effect.sync(() => {
      requestAnimationFrame(() => {
        const card = document.getElementById(`finding-${findingId}`);
        card?.scrollIntoView({ block: "center" });
        card?.querySelector<HTMLElement>(".inline-finding__title")?.focus({ preventScroll: true });
      });
      return Message.PerformedDomEffect();
    }),
});

/**
 * Long enough to swallow a double tap, short enough that a reviewer who read the next finding never waits.
 */
export const SettleSelection = Command.define("SettleSelection", {
  args: { version: S.Number },
  messages: [Message.SettledSelection],
  execute: ({ version }) => Effect.sleep(SETTLE_DELAY_MS).pipe(Effect.as(Message.SettledSelection({ version }))),
});
