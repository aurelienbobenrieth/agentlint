import type { Html, HtmlBuilder } from "foldkit/html";
import type { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import type { Model } from "../../model";
import { Message } from "../../message";
import { button } from "../../shared/ui/controls";
import { summarizeCalibration } from "@aurelienbbn/agentlint/calibration";
import { currentCalibrationReport } from "./selectors";

export const calibrationPanel = (state: ReviewStatePayload, model: Model, h: HtmlBuilder<Message>): Html => {
  const report = currentCalibrationReport(state, model);
  const metrics = summarizeCalibration([report]);
  return h.details(
    [h.Class("calibration-metrics")],
    [
      h.summary([], [`Calibration · ${report.observations.length}/${state.findings.length} labelled`]),
      h.p(
        [],
        ["Applicability uses decided labels; unsure is counted separately. These observations do not change the gate."],
      ),
      ...metrics.rules.map((rule) =>
        h.div(
          [h.Class("calibration-metrics__rule")],
          [
            h.strong([], [rule.ruleId]),
            h.p([], [`${rule.applies} applies · ${rule.doesNotApply} does not apply · ${rule.unsure} unsure`]),
            h.p(
              [],
              [
                `Applicability: ${rule.applicabilityRate === null ? "not measured" : `${Math.round(rule.applicabilityRate * 100)}%`} · ${rule.invalidatedEvidence} changed evidence observed`,
              ],
            ),
            ...Object.entries(rule.reasons).map(([reason, count]) => h.p([], [`${reason}: ${count}`])),
          ],
        ),
      ),
      h.p(
        [],
        [
          "Export reports from successive reviews and combine them with agentlint rules calibration to measure repeated invalidations.",
        ],
      ),
      button("Download calibration report", Message.ClickedDownloadCalibration(), "secondary", h, {
        size: "sm",
        disabled: model.busyFindingId !== null,
      }),
    ],
  );
};
