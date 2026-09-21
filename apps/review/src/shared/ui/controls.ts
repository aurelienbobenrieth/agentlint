import type { Html, HtmlBuilder } from "foldkit/html";

import type { Message } from "../../message";
import { icon, type IconName } from "./icons";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const button = ({
  label,
  message,
  variant,
  h,
  options = {},
}: {
  readonly label: string;
  readonly message: Message;
  readonly variant: ButtonVariant;
  readonly h: HtmlBuilder<Message>;
  readonly options?: { disabled?: boolean; icon?: IconName; size?: "sm" | "md" };
}): Html =>
  h.button(
    [
      h.Type("button"),
      h.OnClick(message),
      h.Disabled(options.disabled ?? false),
      h.Class(`btn btn--${variant}${options.size === "sm" ? " btn--sm" : ""}`),
    ],
    [...(options.icon === undefined ? [] : [icon({ name: options.icon, h })]), h.span([], [label])],
  );

export const kbd = ({
  keys,
  h,
}: {
  readonly keys: ReadonlyArray<string>;
  readonly h: HtmlBuilder<Message>;
}): ReadonlyArray<Html> => keys.map((key) => h.kbd([h.Class("kbd")], [key]));

/**
 * Linear-style tooltip: label plus the shortcut caps, shown on hover and focus.
 */
export const tip = ({
  label,
  keys,
  trigger,
  h,
}: {
  readonly label: string;
  readonly keys: ReadonlyArray<string>;
  readonly trigger: Html;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.span(
    [h.Class("tip")],
    [trigger, h.span([h.Class("tip__bubble"), h.Role("tooltip")], [h.span([], [label]), ...kbd({ keys, h })])],
  );

export const iconButton = ({
  label,
  attributes,
  name,
  h,
  keys = [],
}: {
  readonly label: string;
  readonly attributes: ReadonlyArray<Parameters<HtmlBuilder<Message>["button"]>[0][number]>;
  readonly name: IconName;
  readonly h: HtmlBuilder<Message>;
  readonly keys?: ReadonlyArray<string>;
}): Html =>
  tip({
    label,
    keys,
    trigger: h.button([h.Type("button"), h.Class("icon-btn"), h.AriaLabel(label), ...attributes], [icon({ name, h })]),
    h,
  });
