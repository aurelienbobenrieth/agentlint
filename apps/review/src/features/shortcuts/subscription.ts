import { Option } from "effect";
import { Subscription } from "foldkit";

import { Message } from "../../message";
import type { Shortcut } from "../../model";
import type { SubscriptionEntry } from "../../shared/subscription";

export const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/** Linear-style single-key shortcuts outside inputs; modifier chords inside them. */
export const shortcutFor = (event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly editable: boolean;
}): Shortcut | null => {
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === "Escape") return "escape";
  if (event.editable) {
    if (mod && event.key === "Enter") return event.shiftKey ? "request_changes" : "accept";
    return null;
  }
  if (mod || event.altKey) return null;
  switch (event.key) {
    case "j":
    case "ArrowDown":
      return "next";
    case "k":
    case "ArrowUp":
      return "previous";
    case "a":
      return "accept";
    case "r":
      return "request_changes";
    case "e":
      return "open";
    case "c":
      return "copy";
    case "/":
      return "search";
    case "f":
      return "filters";
    case "1":
      return "queue";
    case "2":
      return "decisions";
    case "[":
      return "sidebar";
    case "g":
      return "guidance";
    case "?":
      return "help";
    case "x":
      return "dismiss_toast";
    default:
      return null;
  }
};

export const keyboard = (entry: SubscriptionEntry) =>
  entry(
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
          return Option.some(Message.PressedShortcut({ action }));
        },
      }),
    ),
  );
