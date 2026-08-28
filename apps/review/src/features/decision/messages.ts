import { Schema as S } from "effect";

import { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Calibration } from "../../model";

export const fields = {
  UpdatedReason: { findingId: S.String, value: S.String },
  UpdatedNote: { findingId: S.String, value: S.String },
  SelectedCalibration: { findingId: S.String, calibration: Calibration },
  ClickedAccept: { findingId: S.String },
  ClickedRequestChanges: { findingId: S.String },
  ClickedWithdraw: { findingId: S.String },
  ClickedSaveCalibration: { findingId: S.String },
  CompletedAction: { findingId: S.String, state: ReviewStatePayload, message: S.String },
  FailedAction: { findingId: S.String, message: S.String },
} satisfies Record<string, S.Struct.Fields>;
