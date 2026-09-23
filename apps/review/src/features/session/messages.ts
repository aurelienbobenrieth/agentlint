import { Schema as S } from "effect";

import { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { PersistedReview } from "../../shared/model";

export const fields = {
  /**
   * `savedError` reports a browser store that could not be read at all; the review then opens without saved drafts.
   */
  LoadedState: {
    state: ReviewStatePayload,
    saved: S.NullOr(PersistedReview),
    savedUnreadable: S.Boolean,
    savedError: S.NullOr(S.String),
  },
  FailedLoadState: { message: S.String },
  ClickedReloadReview: {},
  /**
   * The debounce timer for a text edit fired. Only the latest `version` writes.
   */
  ElapsedPersistDelay: { version: S.Number },
  CompletedPersistence: {},
  FailedPersistence: { message: S.String },
} satisfies Record<string, S.Struct.Fields>;
