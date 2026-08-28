import { Schema as S } from "effect";

import { View } from "../../model";

export const fields = {
  SelectedView: { view: View },
  SelectedFinding: { findingId: S.String },
} satisfies Record<string, S.Struct.Fields>;
