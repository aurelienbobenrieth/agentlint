import { Schema as S } from "effect";

import { ReviewProgress, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
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
  /**
   * `null` when the server could not answer; the page keeps waiting for the state either way.
   */
  ReceivedProgress: { progress: S.NullOr(ReviewProgress) },
  ClickedReloadReview: {},
  /**
   * The debounce timer for a text edit fired. Only the latest `version` writes.
   */
  ElapsedPersistDelay: { version: S.Number },
  CompletedPersistence: {},
  FailedPersistence: { message: S.String },
} satisfies Record<string, S.Struct.Fields>;
