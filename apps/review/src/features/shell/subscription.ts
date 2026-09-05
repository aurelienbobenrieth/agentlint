import { Effect, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";

import { Message } from "../../message";
import type { SubscriptionEntry } from "../../shared/subscription";

/** Pointer tracking only runs while a resize drag is active. */
export const sidebarResize = (entry: SubscriptionEntry) =>
  entry(
    { resizing: S.Boolean },
    {
      modelToDependencies: (model) => ({ resizing: model.resizingSidebar }),
      dependenciesToStream: ({ resizing }) =>
        Stream.when(
          Stream.merge(
            Subscription.fromEvent<PointerEvent, Message>({
              target: () => window,
              type: "pointermove",
              toMessage: (event) => Message.ResizedSidebar({ width: event.clientX }),
            }),
            Subscription.fromEvent<PointerEvent, Message>({
              target: () => window,
              type: "pointerup",
              toMessage: () => Message.EndedSidebarResize(),
            }),
          ),
          Effect.sync(() => resizing),
        ),
    },
  );
