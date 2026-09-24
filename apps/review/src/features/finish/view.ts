import type { Html, HtmlBuilder } from "foldkit/html";

import { Message } from "../../message";
import { button } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";

export const finishedView = ({
  summary,
  feedback,
  acceptanceOutput,
  calibrationOutput,
  h,
}: {
  readonly summary: string;
  readonly feedback: string;
  readonly acceptanceOutput: string;
  readonly calibrationOutput: string;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.main(
    [h.Class("finish")],
    [
      h.div([h.Class("finish__mark")], [icon({ name: "check", h })]),
      // Focused on arrival (see `finished` in update) so the screen change is announced.
      h.h1([h.Tabindex(-1)], ["Review complete"]),
      h.p([h.Class("finish__summary")], [summary]),
      ...(feedback.length > 0 ? [h.pre([h.Class("finish__output")], [feedback])] : []),
      h.div(
        [h.Class("finish__actions")],
        [
          ...(feedback.length > 0
            ? [
                button({
                  label: "Copy for your agent",
                  message: Message.ClickedCopyInstructions(),
                  variant: "primary",
                  h,
                  options: { icon: "copy" },
                }),
              ]
            : []),
          ...(calibrationOutput.length > 0
            ? [
                button({
                  label: "Download calibration report",
                  message: Message.ClickedDownloadCalibration(),
                  variant: "secondary",
                  h,
                }),
              ]
            : []),
          ...(acceptanceOutput.length > 0
            ? [
                button({
                  label: "Download acceptances",
                  message: Message.ClickedDownloadAcceptances(),
                  variant: "secondary",
                  h,
                }),
              ]
            : []),
        ],
      ),
    ],
  );
