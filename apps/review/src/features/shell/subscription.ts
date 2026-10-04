import { Effect, Schema as S, Stream } from "effect";
import { Subscription } from "foldkit";

import { Message } from "../../message";
import type { SubscriptionEntry } from "../../shared/subscription";

const ended = (type: "pointerup" | "pointercancel") =>
  Subscription.fromEvent({ target: () => window, type, mapEvent: () => Message.EndedSidebarResize() });

const filesEnded = (type: "pointerup" | "pointercancel") =>
  Subscription.fromEvent({ target: () => window, type, mapEvent: () => Message.EndedFilesResize() });

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
              mapEvent: (event) => Message.ResizedSidebar({ width: event.clientX }),
            }),
            Stream.merge(ended("pointerup"), ended("pointercancel")),
          ),
          Effect.sync(() => resizing),
        ),
    },
  );

/**
 * The files pane's drag, as `sidebarResize` but measured from the window's right edge.
 */
export const filesResize = (entry: SubscriptionEntry) =>
  entry(
    { resizing: S.Boolean },
    {
      modelToDependencies: (model) => ({ resizing: model.resizingFiles }),
      dependenciesToStream: ({ resizing }) =>
        Stream.when(
          Stream.merge(
            Subscription.fromEvent({
              target: () => window,
              type: "pointermove",
              mapEvent: (event) => Message.ResizedFiles({ width: window.innerWidth - event.clientX }),
            }),
            Stream.merge(filesEnded("pointerup"), filesEnded("pointercancel")),
          ),
          Effect.sync(() => resizing),
        ),
    },
  );
