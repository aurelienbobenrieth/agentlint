import type { Html, HtmlBuilder } from "foldkit/html";

import type { Message } from "../../message";
import { icon, type IconName } from "./icons";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const button = (
  label: string,
  message: Message,
  variant: ButtonVariant,
  h: HtmlBuilder<Message>,
  options: { disabled?: boolean; icon?: IconName; size?: "sm" | "md" } = {},
): Html =>
  h.button(
    [
      h.Type("button"),
      h.OnClick(message),
      h.Disabled(options.disabled ?? false),
      h.Class(`btn btn--${variant}${options.size === "sm" ? " btn--sm" : ""}`),
    ],
    [...(options.icon === undefined ? [] : [icon(options.icon, h)]), h.span([], [label])],
  );

export const kbd = (keys: ReadonlyArray<string>, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  keys.map((key) => h.kbd([h.Class("kbd")], [key]));

/** Linear-style tooltip: label plus the shortcut caps, shown on hover and focus. */
export const tip = (label: string, keys: ReadonlyArray<string>, trigger: Html, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class("tip")],
    [trigger, h.span([h.Class("tip__bubble"), h.Role("tooltip")], [h.span([], [label]), ...kbd(keys, h)])],
  );

export const iconButton = (
  label: string,
  attributes: ReadonlyArray<Parameters<HtmlBuilder<Message>["button"]>[0][number]>,
  name: IconName,
  h: HtmlBuilder<Message>,
  keys: ReadonlyArray<string> = [],
): Html =>
  tip(
    label,
    keys,
    h.button([h.Type("button"), h.Class("icon-btn"), h.AriaLabel(label), ...attributes], [icon(name, h)]),
    h,
  );
