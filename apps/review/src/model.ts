import { Schema as S } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

import { EditorApplicationId, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";

export const Screen = defineTaggedUnion({
  Loading: {},
  LoadFailed: { message: S.String },
  Reviewing: { state: ReviewStatePayload },
  Finished: { summary: S.String, feedback: S.String, acceptanceOutput: S.String },
});
export type Screen = typeof Screen.Type;

/** Queue holds everything a reviewer still owes a decision. Decisions holds what is already accepted. */
export const View = S.Literals(["queue", "decisions"]);
export type View = typeof View.Type;

export const StatusFacet = S.Literals(["open", "changes_requested", "accepted"]);
export type StatusFacet = typeof StatusFacet.Type;

export const AuthorityFacet = S.Literals(["human", "agent"]);
export type AuthorityFacet = typeof AuthorityFacet.Type;

export const LifecycleFacet = S.Literals(["state", "change"]);
export type LifecycleFacet = typeof LifecycleFacet.Type;

export const Shortcut = S.Literals([
  "next",
  "previous",
  "accept",
  "request_changes",
  "open",
  "copy",
  "search",
  "filters",
  "queue",
  "decisions",
  "sidebar",
  "guidance",
  "help",
  "dismiss_toast",
  "escape",
]);
export type Shortcut = typeof Shortcut.Type;

export const GroupBy = S.Literals(["file", "rule"]);
export type GroupBy = typeof GroupBy.Type;

export const Facets = S.Struct({
  statuses: S.Array(StatusFacet),
  authorities: S.Array(AuthorityFacet),
  lifecycles: S.Array(LifecycleFacet),
  ruleIds: S.Array(S.String),
});
export type Facets = typeof Facets.Type;

export const ToastTone = S.Literals(["neutral", "success", "danger"]);
export type ToastTone = typeof ToastTone.Type;

export const ToastPhase = S.Literals(["visible", "leaving"]);
export type ToastPhase = typeof ToastPhase.Type;

export const Toast = S.Struct({
  id: S.Number,
  message: S.String,
  tone: ToastTone,
  phase: ToastPhase,
});
export type Toast = typeof Toast.Type;

export const CodeView = S.Literals(["focused", "full"]);
export type CodeView = typeof CodeView.Type;

export const Calibration = S.Literals(["unreviewed", "applies", "does_not_apply", "unsure"]);
export type Calibration = typeof Calibration.Type;

export const Draft = S.Struct({
  reason: S.String,
  calibration: Calibration,
  note: S.String,
  disposition: S.Literals(["none", "accept", "request_changes"]),
});
export type Draft = typeof Draft.Type;

export const PersistedReview = S.Struct({
  version: S.Literal(3),
  view: View,
  facets: Facets,
  groupBy: GroupBy,
  codeView: CodeView,
  guidanceOpen: S.Boolean,
  sidebarOpen: S.Boolean,
  sidebarWidth: S.Number,
  preferredApplication: S.NullOr(EditorApplicationId),
  query: S.String,
  selectedFindingId: S.NullOr(S.String),
  drafts: S.Record(S.String, Draft),
});
export type PersistedReview = typeof PersistedReview.Type;

export const Model = S.Struct({
  screen: Screen,
  view: View,
  facets: Facets,
  groupBy: GroupBy,
  codeView: CodeView,
  guidanceOpen: S.Boolean,
  sidebarOpen: S.Boolean,
  sidebarWidth: S.Number,
  resizingSidebar: S.Boolean,
  preferredApplication: S.NullOr(EditorApplicationId),
  query: S.String,
  selectedFindingId: S.NullOr(S.String),
  drafts: S.Record(S.String, Draft),
  busyFindingId: S.NullOr(S.String),
  helpOpen: S.Boolean,
  /** Modifier glyph for tooltips: ⌘ on Apple platforms, Ctrl elsewhere. */
  modKey: S.Literals(["⌘", "Ctrl"]),
  /** Hovering the toast stack pauses expiry so a reader is never raced by the timer. */
  toastsPaused: S.Boolean,
  toasts: S.Array(Toast),
  nextToastId: S.Number,
  saveState: S.Literals(["idle", "saving", "saved", "failed"]),
  /** Bumped by every debounced save request. Only the timer carrying the latest version writes. */
  saveVersion: S.Number,
});
export type Model = typeof Model.Type;

export const emptyFacets = (): Facets => ({ statuses: [], authorities: [], lifecycles: [], ruleIds: [] });

const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 520;
export const SIDEBAR_DEFAULT = 300;
export const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));

export const emptyDraft = (): Draft => ({
  reason: "",
  calibration: "unreviewed",
  note: "",
  disposition: "none",
});

export const persistedReview = (model: Model): PersistedReview => ({
  version: 3,
  view: model.view,
  facets: model.facets,
  groupBy: model.groupBy,
  codeView: model.codeView,
  guidanceOpen: model.guidanceOpen,
  sidebarOpen: model.sidebarOpen,
  sidebarWidth: model.sidebarWidth,
  preferredApplication: model.preferredApplication,
  query: model.query,
  selectedFindingId: model.selectedFindingId,
  drafts: model.drafts,
});
