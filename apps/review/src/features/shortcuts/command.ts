import { Effect, Schema as S } from "effect";
import { Command } from "foldkit";

import { Message } from "../../message";

/** DOM side effects behind keyboard shortcuts. They never change the model. */
export const FocusElement = Command.define("FocusElement", {
  args: { selector: S.String },
  messages: [Message.PerformedDomEffect],
  execute: ({ selector }) =>
    Effect.sync(() => {
      const element = document.querySelector<HTMLElement>(selector);
      element?.focus();
      if (element instanceof HTMLTextAreaElement) element.setSelectionRange(element.value.length, element.value.length);
      return Message.PerformedDomEffect();
    }),
});

export const TogglePopover = Command.define("TogglePopover", {
  args: { id: S.String },
  messages: [Message.PerformedDomEffect],
  execute: ({ id }) =>
    Effect.sync(() => {
      document.getElementById(id)?.togglePopover();
      return Message.PerformedDomEffect();
    }),
});

export const BlurActive = Command.define("BlurActive", {
  messages: [Message.PerformedDomEffect],
  execute: Effect.sync(() => {
    for (const popover of document.querySelectorAll<HTMLElement>("[popover]:popover-open")) popover.hidePopover();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return Message.PerformedDomEffect();
  }),
});

export const RevealSelectedRow = Command.define("RevealSelectedRow", {
  messages: [Message.PerformedDomEffect],
  execute: Effect.sync(() => {
    requestAnimationFrame(() => {
      document.querySelector(".row--selected")?.scrollIntoView({ block: "nearest" });
    });
    return Message.PerformedDomEffect();
  }),
});
