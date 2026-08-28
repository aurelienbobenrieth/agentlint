import { Schema as S } from "effect";
import { m } from "foldkit/message";

import {
  AuthorityFacet,
  Calibration,
  CodeView,
  GroupBy,
  LifecycleFacet,
  PersistedReview,
  Shortcut,
  StatusFacet,
  ToastTone,
  View,
} from "./model";
import { ReviewStatePayload } from "./types";
import { EditorApplicationId } from "./types";

export const LoadedState = m("LoadedState", { state: ReviewStatePayload, saved: S.NullOr(PersistedReview) });
export const FailedLoadState = m("FailedLoadState", { message: S.String });
export const SelectedView = m("SelectedView", { view: View });
export const ToggledStatusFacet = m("ToggledStatusFacet", { status: StatusFacet });
export const ToggledAuthorityFacet = m("ToggledAuthorityFacet", { authority: AuthorityFacet });
export const ToggledRuleFacet = m("ToggledRuleFacet", { ruleId: S.String });
export const ToggledLifecycleFacet = m("ToggledLifecycleFacet", { lifecycle: LifecycleFacet });
export const ClearedFacets = m("ClearedFacets");
export const SelectedGroupBy = m("SelectedGroupBy", { groupBy: GroupBy });
export const SelectedCodeView = m("SelectedCodeView", { codeView: CodeView });
export const ToggledGuidance = m("ToggledGuidance");
/** Mirrors the native <details> toggle so a controlled `open` never fights the DOM. */
export const SetGuidanceOpen = m("SetGuidanceOpen", { open: S.Boolean });
export const StartedSidebarResize = m("StartedSidebarResize");
export const ResizedSidebar = m("ResizedSidebar", { width: S.Number });
export const EndedSidebarResize = m("EndedSidebarResize");
export const ToggledHelp = m("ToggledHelp");
export const PressedShortcut = m("PressedShortcut", { action: Shortcut });
export const UpdatedQuery = m("UpdatedQuery", { value: S.String });
export const ToggledSidebar = m("ToggledSidebar");
export const PreparedDecision = m("PreparedDecision", {
  findingId: S.String,
  intent: S.Literals(["accept", "request_changes"]),
});
export const SelectedFinding = m("SelectedFinding", { findingId: S.String });
export const UpdatedReason = m("UpdatedReason", { findingId: S.String, value: S.String });
export const UpdatedNote = m("UpdatedNote", { findingId: S.String, value: S.String });
export const SelectedCalibration = m("SelectedCalibration", {
  findingId: S.String,
  calibration: Calibration,
});
export const ClickedAccept = m("ClickedAccept", { findingId: S.String });
export const ClickedRequestChanges = m("ClickedRequestChanges", { findingId: S.String });
export const ClickedWithdraw = m("ClickedWithdraw", { findingId: S.String });
export const HoveredToasts = m("HoveredToasts");
export const LeftToasts = m("LeftToasts");
export const ClickedSaveCalibration = m("ClickedSaveCalibration", { findingId: S.String });
export const CompletedAction = m("CompletedAction", {
  findingId: S.String,
  state: ReviewStatePayload,
  message: S.String,
});
export const FailedAction = m("FailedAction", { findingId: S.String, message: S.String });
export const ClickedFinish = m("ClickedFinish");
export const ClickedCheckpoint = m("ClickedCheckpoint");
export const CompletedPersistence = m("CompletedPersistence");
export const FailedPersistence = m("FailedPersistence", { message: S.String });
export const PreparedDetachedFinish = m("PreparedDetachedFinish", {
  acceptedAt: S.String,
});
export const CompletedFinish = m("CompletedFinish", {
  summary: S.String,
  feedback: S.String,
  acceptanceOutput: S.String,
});
export const FailedFinish = m("FailedFinish", { message: S.String });
export const ClickedCopyInstructions = m("ClickedCopyInstructions");
export const ClickedCopyFindingContext = m("ClickedCopyFindingContext", { findingId: S.String });
export const ClickedOpenFinding = m("ClickedOpenFinding", { findingId: S.String });
export const SelectedEditorApplication = m("SelectedEditorApplication", {
  findingId: S.String,
  application: EditorApplicationId,
});
export const ClickedDownloadAcceptances = m("ClickedDownloadAcceptances");
export const CompletedUtility = m("CompletedUtility", { message: S.String, tone: ToastTone });
export const ClickedDismissToast = m("ClickedDismissToast", { id: S.Number });
export const ExpiredToast = m("ExpiredToast", { id: S.Number });
export const RemovedToast = m("RemovedToast", { id: S.Number });
/** Emitted by DOM-only commands (focus, scroll, popovers). The model ignores it. */
export const PerformedDomEffect = m("PerformedDomEffect");

export const Message = S.Union([
  LoadedState,
  FailedLoadState,
  SelectedView,
  ToggledStatusFacet,
  ToggledAuthorityFacet,
  ToggledRuleFacet,
  ToggledLifecycleFacet,
  ClearedFacets,
  SelectedGroupBy,
  SelectedCodeView,
  ToggledGuidance,
  SetGuidanceOpen,
  StartedSidebarResize,
  ResizedSidebar,
  EndedSidebarResize,
  ToggledHelp,
  PressedShortcut,
  UpdatedQuery,
  ToggledSidebar,
  PreparedDecision,
  SelectedFinding,
  UpdatedReason,
  UpdatedNote,
  SelectedCalibration,
  ClickedAccept,
  ClickedRequestChanges,
  ClickedWithdraw,
  HoveredToasts,
  LeftToasts,
  ClickedSaveCalibration,
  CompletedAction,
  FailedAction,
  ClickedFinish,
  ClickedCheckpoint,
  CompletedPersistence,
  FailedPersistence,
  PreparedDetachedFinish,
  CompletedFinish,
  FailedFinish,
  ClickedCopyInstructions,
  ClickedCopyFindingContext,
  ClickedOpenFinding,
  SelectedEditorApplication,
  ClickedDownloadAcceptances,
  CompletedUtility,
  ClickedDismissToast,
  ExpiredToast,
  RemovedToast,
  PerformedDomEffect,
]);
export type Message = typeof Message.Type;
