import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../../message";
import { button } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";

export const finishedView = (
  summary: string,
  feedback: string,
  acceptanceOutput: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.main(
    [h.Class("finish")],
    [
      h.div([h.Class("finish__mark")], [icon("check", h)]),
      h.h1([], ["Review complete"]),
      h.p([h.Class("finish__summary")], [summary]),
      ...(feedback.length > 0 ? [h.pre([h.Class("finish__output")], [feedback])] : []),
      h.div(
        [h.Class("finish__actions")],
        [
          ...(feedback.length > 0
            ? [button("Copy for your agent", Message.ClickedCopyInstructions(), "primary", h, { icon: "copy" })]
            : []),
          ...(acceptanceOutput.length > 0
            ? [button("Download acceptances", Message.ClickedDownloadAcceptances(), "secondary", h)]
            : []),
        ],
      ),
    ],
  );
