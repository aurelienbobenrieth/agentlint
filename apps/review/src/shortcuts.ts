import type { Shortcut } from "./model";

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
