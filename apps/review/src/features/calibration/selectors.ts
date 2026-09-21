import { calibrationReport } from "@aurelienbbn/agentlint/calibration";
import type { CalibrationReport, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import type { Model } from "../../model";
import { draftFor } from "../../shared/selectors";
import { encodePrettyJson } from "../../shared/json";

export const currentCalibrationReport = ({
  state,
  model,
}: {
  readonly state: ReviewStatePayload;
  readonly model: Model;
}): CalibrationReport =>
  calibrationReport({
    state,
    observations:
      state.transport === "attached"
        ? state.calibration
        : state.findings.flatMap((finding) => {
            const saved = draftFor({ model, findingId: finding.id }).savedCalibration;
            return saved === null ? [] : [saved];
          }),
  });

export const calibrationOutput = (model: Model): string =>
  model.screen._tag === "Reviewing" && model.screen.state.mode === "calibration"
    ? `${encodePrettyJson(currentCalibrationReport({ state: model.screen.state, model }))}\n`
    : "";
