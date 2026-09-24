import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../../message";
import type { Model } from "../../shared/model";
import { iconButton, kbd } from "../../shared/ui/controls";

export const helpDialog = ({ model, h }: { readonly model: Model; readonly h: HtmlBuilder<Message> }): Html => {
  const group = ({
    title,
    rows,
  }: {
    readonly title: string;
    readonly rows: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
  }): Html =>
    h.div(
      [h.Class("help__group")],
      [
        h.h3([], [title]),
        ...rows.map(([label, keys]) =>
          h.div([h.Class("help__row")], [h.span([], [label]), h.span([h.Class("help__keys")], kbd({ keys, h }))]),
        ),
      ],
    );
  return h.dialog(
    [h.Class("help"), h.AriaLabel("Keyboard shortcuts"), h.OnCancel(Message.ClosedHelp())],
    [
      h.div([h.Class("help__backdrop"), h.OnClick(Message.ClosedHelp())], []),
      h.div(
        [h.Class("help__panel")],
        [
          h.div(
            [h.Class("help__head")],
            [
              h.h2([], ["Keyboard shortcuts"]),
              iconButton({
                label: "Close",
                attributes: [h.OnClick(Message.ClosedHelp())],
                name: "x",
                h,
                keys: ["Esc"],
              }),
            ],
          ),
          h.div(
            [h.Class("help__columns")],
            [
              group({
                title: "Navigate",
                rows: [
                  ["Next finding", ["J"]],
                  ["Previous finding", ["K"]],
                  ["Queue", ["1"]],
                  ["Decisions", ["2"]],
                  ["Search", ["/"]],
                  ["Filters", ["F"]],
                  ["Toggle list", ["["]],
                ],
              }),
              group({
                title: "Decide",
                rows: [
                  ["Accept", ["A"]],
                  ["Accept from field", [model.modKey, "Enter"]],
                  ["Request changes", ["R"]],
                  ["Request changes from field", ["Shift", model.modKey, "Enter"]],
                  ["Open in editor", ["E"]],
                  ["Copy context", ["C"]],
                  ["Rule guidance", ["G"]],
                  ["Dismiss toast", ["X"]],
                  ["Close / unfocus", ["Esc"]],
                ],
              }),
            ],
          ),
        ],
      ),
    ],
  );
};
