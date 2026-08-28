import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../../message";
import type { Model } from "../../model";
import { iconButton, kbd } from "../../shared/ui/controls";

export const helpDialog = (model: Model, h: HtmlBuilder<Message>): Html => {
  const group = (title: string, rows: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): Html =>
    h.div(
      [h.Class("help__group")],
      [
        h.h3([], [title]),
        ...rows.map(([label, keys]) =>
          h.div([h.Class("help__row")], [h.span([], [label]), h.span([h.Class("help__keys")], kbd(keys, h))]),
        ),
      ],
    );
  return h.div(
    [h.Class("help"), h.Role("dialog"), h.AriaLabel("Keyboard shortcuts")],
    [
      h.div([h.Class("help__backdrop"), h.OnClick(Message.ToggledHelp())], []),
      h.div(
        [h.Class("help__panel")],
        [
          h.div(
            [h.Class("help__head")],
            [
              h.h2([], ["Keyboard shortcuts"]),
              iconButton("Close", [h.OnClick(Message.ToggledHelp())], "x", h, ["Esc"]),
            ],
          ),
          h.div(
            [h.Class("help__columns")],
            [
              group("Navigate", [
                ["Next finding", ["J"]],
                ["Previous finding", ["K"]],
                ["Queue", ["1"]],
                ["Decisions", ["2"]],
                ["Search", ["/"]],
                ["Filters", ["F"]],
                ["Toggle list", ["["]],
              ]),
              group("Decide", [
                ["Accept", ["A"]],
                ["Accept from field", [model.modKey, "Enter"]],
                ["Request changes", ["R"]],
                ["Request changes from field", ["Shift", model.modKey, "Enter"]],
                ["Open in editor", ["E"]],
                ["Copy context", ["C"]],
                ["Rule guidance", ["G"]],
                ["Dismiss toast", ["X"]],
                ["Close / unfocus", ["Esc"]],
              ]),
            ],
          ),
        ],
      ),
    ],
  );
};
