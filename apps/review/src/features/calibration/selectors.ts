import { calibrationReport } from "@aurelienbbn/agentlint/calibration";
import type { CalibrationReport, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import type { Model } from "../../model";
import { draftFor } from "../../shared/selectors";

export const currentCalibrationReport = (state: ReviewStatePayload, model: Model): CalibrationReport =>
  calibrationReport(
    state,
    state.transport === "attached"
      ? state.calibration
      : state.findings.flatMap((finding) => {
          const saved = draftFor(model, finding.id).savedCalibration;
          return saved === null ? [] : [saved];
        }),
  );

export const calibrationOutput = (model: Model): string =>
  model.screen._tag === "Reviewing" && model.screen.state.mode === "calibration"
    ? JSON.stringify(currentCalibrationReport(model.screen.state, model), null, 2) + "\n"
    : "";
