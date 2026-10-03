import { Schema as S } from "effect";

import { EditorApplicationId } from "@aurelienbbn/agentlint/contract";
import { CodeView } from "../../shared/model";

export const fields = {
  SelectedCodeView: { codeView: CodeView },
  SelectedFile: { findingId: S.String, file: S.String },
  ToggledFileDirectory: { path: S.String },
  ToggledFiles: {},
  ToggledGuidance: {},
  ToggledIndependentReview: {},
  UpdatedIndependentNote: { findingId: S.String, value: S.String },
  RevealedPriorDecision: { findingId: S.String },
  /**
   * Mirrors the native <details> toggle so a controlled `open` never fights the DOM.
   */
  SetGuidanceOpen: { open: S.Boolean },
  ClickedCopyFindingContext: { findingId: S.String },
  ClickedOpenFinding: { findingId: S.String },
  SelectedEditorApplication: { findingId: S.String, application: EditorApplicationId },
} satisfies Record<string, S.Struct.Fields>;
