import { Schema as S } from "effect";

import { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { PersistedReview } from "../../model";

export const fields = {
  LoadedState: { state: ReviewStatePayload, saved: S.NullOr(PersistedReview) },
  FailedLoadState: { message: S.String },
  /** The debounce timer for a text edit fired. Only the latest `version` writes. */
  ElapsedPersistDelay: { version: S.Number },
  CompletedPersistence: {},
  FailedPersistence: { message: S.String },
} satisfies Record<string, S.Struct.Fields>;
