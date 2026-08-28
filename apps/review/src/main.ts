import { Effect, Option, Schema as S, Stream } from "effect";
import { Runtime, Subscription } from "foldkit";

import { LoadReview } from "./command";
import { Message } from "./message";
import { Loading, Model, SIDEBAR_DEFAULT } from "./model";
import { isEditable, shortcutFor } from "./shortcuts";
import { EndedSidebarResize, PressedShortcut, ResizedSidebar } from "./message";
import { update } from "./update";
import { view } from "./view";

export const Flags = S.Struct({});
export type Flags = typeof Flags.Type;
export const flags = Effect.succeed({});

export const init: Runtime.ApplicationInit<Model, Message, Flags> = () => [
  {
    screen: Loading(),
    view: "queue",
    facets: { statuses: [], authorities: [], lifecycles: [], ruleIds: [] },
    groupBy: "file",
    codeView: "focused",
    guidanceOpen: false,
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_DEFAULT,
    resizingSidebar: false,
    preferredApplication: null,
    query: "",
    selectedFindingId: null,
    drafts: {},
    busyFindingId: null,
    helpOpen: false,
    toastsPaused: false,
    modKey: typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘" : "Ctrl",
    toasts: [],
    nextToastId: 1,
    saveState: "idle",
  },
  [LoadReview()],
];

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  sidebarResize: entry(
    { resizing: S.Boolean },
    {
      modelToDependencies: (model) => ({ resizing: model.resizingSidebar }),
      dependenciesToStream: ({ resizing }) =>
        Stream.when(
          Stream.merge(
            Subscription.fromEvent<PointerEvent, Message>({
              target: () => window,
              type: "pointermove",
              toMessage: (event) => ResizedSidebar({ width: event.clientX }),
            }),
            Subscription.fromEvent<PointerEvent, Message>({
              target: () => window,
              type: "pointerup",
              toMessage: () => EndedSidebarResize(),
            }),
          ),
          Effect.sync(() => resizing),
        ),
    },
  ),
  keyboard: entry(
    {},
    Subscription.persistent(
      Subscription.fromEventFilterMap<KeyboardEvent, Message>({
        target: () => window,
        type: "keydown",
        toMessage: (event) => {
          if (event.isComposing || event.repeat) return Option.none();
          const action = shortcutFor({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            editable: isEditable(event.target),
          });
          if (action === null) return Option.none();
          if (action !== "escape") event.preventDefault();
          return Option.some(PressedShortcut({ action }));
        },
      }),
    ),
  ),
}));

export { Message, Model, update, view };
