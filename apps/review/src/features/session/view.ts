import type { ReviewProgress } from "@aurelienbbn/agentlint/contract";
import type { Html, HtmlBuilder } from "foldkit/html";

import type { Message } from "../../message";

const plural = (count: number, noun: string): string =>
  `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;

/**
 * What the server is doing, in the words a reviewer waiting on it needs.
 */
const progressLabel = (progress: ReviewProgress | null): string => {
  if (progress === null || progress.phase === "preparing") return "Preparing the review…";
  if (progress.phase === "analyzing") return `Analyzing ${plural(progress.files, "file")}…`;
  if (progress.phase === "comparing") return "Comparing changes with the baseline…";
  return "Loading review…";
};

export const loadingView = ({
  progress,
  h,
}: {
  readonly progress: ReviewProgress | null;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const counting = progress?.phase === "analyzing" && progress.files > 0 ? progress : null;
  return h.main(
    [h.Class("state"), h.AriaBusy(true)],
    [
      h.div([h.Class("loader")], []),
      h.p([h.AriaLive("polite")], [progressLabel(progress)]),
      ...(counting
        ? [
            h.div(
              [
                h.Class("progress"),
                h.Role("progressbar"),
                h.AriaLabel("Files analyzed"),
                h.AriaValuemin(0),
                h.AriaValuemax(counting.files),
                h.AriaValuenow(counting.analyzed),
              ],
              [
                h.div(
                  [
                    h.Class("progress__bar"),
                    h.Style({ width: `${Math.min(100, (100 * counting.analyzed) / counting.files).toFixed(1)}%` }),
                  ],
                  [],
                ),
              ],
            ),
            h.p(
              [h.Class("progress__count")],
              [`${counting.analyzed.toLocaleString("en-US")} of ${counting.files.toLocaleString("en-US")}`],
            ),
          ]
        : []),
    ],
  );
};

export const loadFailedView = ({ message, h }: { readonly message: string; readonly h: HtmlBuilder<Message> }): Html =>
  h.main([h.Class("state")], [h.h1([], ["Review unavailable"]), h.p([], [message])]);
