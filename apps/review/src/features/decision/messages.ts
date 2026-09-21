import { Schema as S } from "effect";

import { CalibrationReason, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Calibration } from "../../model";

export const fields = {
  UpdatedReason: { findingId: S.String, value: S.String },
  SelectedCalibrationReason: { findingId: S.String, reason: S.NullOr(CalibrationReason) },
  UpdatedNote: { findingId: S.String, value: S.String },
  SelectedCalibration: { findingId: S.String, calibration: Calibration },
  ClickedAccept: { findingId: S.String },
  ClickedRequestChanges: { findingId: S.String },
  ClickedWithdraw: { findingId: S.String },
  ClickedSaveCalibration: { findingId: S.String },
  CompletedAction: { findingId: S.String, state: ReviewStatePayload, message: S.String },
  /**
   * The server recorded the decision, but the state that should confirm it could not be fetched.
   */
  RecordedActionRefreshFailed: { findingId: S.String, message: S.String },
  FailedAction: { findingId: S.String, message: S.String },
} satisfies Record<string, S.Struct.Fields>;
