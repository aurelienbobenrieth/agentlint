import { Option } from "effect";
import { Subscription } from "foldkit";

import { Message } from "../../message";
import type { Shortcut } from "../../shared/model";
import type { SubscriptionEntry } from "../../shared/subscription";

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

/**
 * Linear-style single-key shortcuts outside inputs; modifier chords inside them.
 */
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
  const shortcuts: Readonly<Record<string, Shortcut>> = {
    j: "next",
    ArrowDown: "next",
    k: "previous",
    ArrowUp: "previous",
    a: "accept",
    r: "request_changes",
    e: "open",
    c: "copy",
    "/": "search",
    f: "filters",
    "1": "queue",
    "2": "decisions",
    "[": "sidebar",
    g: "guidance",
    "?": "help",
    x: "dismiss_toast",
  };
  return shortcuts[event.key] ?? null;
};

export const keyboard = (entry: SubscriptionEntry) =>
  entry(
    {},
    Subscription.persistent(
      Subscription.fromEventFilterMap({
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
