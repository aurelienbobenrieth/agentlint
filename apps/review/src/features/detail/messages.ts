import { Schema as S } from "effect";

import { EditorApplicationId } from "@aurelienbbn/agentlint/contract";
import { CodeView } from "../../model";

export const fields = {
  SelectedCodeView: { codeView: CodeView },
  ToggledGuidance: {},
  ToggledIndependentReview: {},
  UpdatedIndependentNote: { findingId: S.String, value: S.String },
  RevealedPriorDecision: { findingId: S.String },
  /** Mirrors the native <details> toggle so a controlled `open` never fights the DOM. */
  SetGuidanceOpen: { open: S.Boolean },
  ClickedCopyFindingContext: { findingId: S.String },
  ClickedOpenFinding: { findingId: S.String },
  SelectedEditorApplication: { findingId: S.String, application: EditorApplicationId },
} satisfies Record<string, S.Struct.Fields>;
