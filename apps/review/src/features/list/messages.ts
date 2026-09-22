import { Schema as S } from "effect";

import { View } from "../../shared/model";

export const fields = {
  SelectedView: { view: View },
  SelectedFinding: { findingId: S.String },
  /**
   * The pause after an automatic selection change ended. Only the latest `version` settles.
   */
  SettledSelection: { version: S.Number },
} satisfies Record<string, S.Struct.Fields>;
