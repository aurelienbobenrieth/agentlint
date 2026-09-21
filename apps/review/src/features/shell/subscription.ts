import { Effect, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";

import { Message } from "../../message";
import type { SubscriptionEntry } from "../../shared/subscription";

const ended = (type: "pointerup" | "pointercancel") =>
  Subscription.fromEvent({ target: () => window, type, toMessage: () => Message.EndedSidebarResize() });

/**
 * Pointer tracking only runs while a resize drag is active. `pointercancel` (touch scroll takeover, a system gesture)
 * ends the drag too; without it no `pointerup` follows and the drag would stick.
 */
export const sidebarResize = (entry: SubscriptionEntry) =>
  entry(
    { resizing: S.Boolean },
    {
      modelToDependencies: (model) => ({ resizing: model.resizingSidebar }),
      dependenciesToStream: ({ resizing }) =>
        Stream.when(
          Stream.merge(
            Subscription.fromEvent({
              target: () => window,
              type: "pointermove",
              toMessage: (event) => Message.ResizedSidebar({ width: event.clientX }),
            }),
            Stream.merge(ended("pointerup"), ended("pointercancel")),
          ),
          Effect.sync(() => resizing),
        ),
    },
  );
