import { emptyDraft, type Model, type StatusFacet, type View } from "./model";
import type { ReviewFindingPayload, ReviewStatePayload } from "./types";

/** Status once local drafts (detached decisions, calibration labels) are applied. */
export const effectiveFindingStatus = (
  finding: ReviewFindingPayload,
  state: ReviewStatePayload,
  model: Model,
): ReviewFindingPayload["status"] => {
  const draft = model.drafts[finding.id] ?? emptyDraft();
  if (state.mode === "calibration" && draft.calibration !== "unreviewed") return "accepted";
  // Attached sessions refetch server state after every action, so the server is the
  // truth there; a stale local draft must not paint a decision the server no longer holds.
  if (state.transport === "attached") return finding.status;
  if (draft.disposition === "accept") return "accepted";
  if (draft.disposition === "request_changes") return "changes_requested";
  return finding.status;
};

export const statusFacet = (status: ReviewFindingPayload["status"]): StatusFacet =>
  status === "unresolved" ? "open" : status;

export const inView = (finding: ReviewFindingPayload, view: View, state: ReviewStatePayload, model: Model): boolean => {
  const status = effectiveFindingStatus(finding, state, model);
  return view === "decisions" ? status === "accepted" : status !== "accepted";
};

const matchesFacets = (finding: ReviewFindingPayload, state: ReviewStatePayload, model: Model): boolean => {
  const { statuses, authorities, lifecycles, ruleIds } = model.facets;
  const status = statusFacet(effectiveFindingStatus(finding, state, model));
  return (
    (statuses.length === 0 || statuses.includes(status)) &&
    (authorities.length === 0 || authorities.includes(finding.authority)) &&
    (lifecycles.length === 0 || lifecycles.includes(finding.lifecycle)) &&
    (ruleIds.length === 0 || ruleIds.includes(finding.ruleId))
  );
};

const matchesQuery = (finding: ReviewFindingPayload, query: string): boolean =>
  query.length === 0 ||
  [finding.ruleId, finding.ruleTitle, finding.file, finding.message].some((value) =>
    value.toLocaleLowerCase().includes(query),
  );

export const facetCount = (model: Model): number =>
  model.facets.statuses.length +
  model.facets.authorities.length +
  model.facets.lifecycles.length +
  model.facets.ruleIds.length;

/** The findings the sidebar lists, in display order. */
export const visibleFindings = (state: ReviewStatePayload, model: Model): ReadonlyArray<ReviewFindingPayload> => {
  const query = model.query.trim().toLocaleLowerCase();
  const findings = state.findings.filter(
    (finding) =>
      inView(finding, model.view, state, model) && matchesFacets(finding, state, model) && matchesQuery(finding, query),
  );
  if (model.view === "decisions") {
    return findings.toSorted(
      (left, right) =>
        (right.acceptance?.at ?? "").localeCompare(left.acceptance?.at ?? "") ||
        left.file.localeCompare(right.file) ||
        left.line - right.line,
    );
  }
  return findings.toSorted((left, right) =>
    model.groupBy === "rule"
      ? left.ruleId.localeCompare(right.ruleId) || left.file.localeCompare(right.file) || left.line - right.line
      : left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column,
  );
};

/** The finding the detail pane shows: the selected one if listed, else the first listed. */
export const selectedFinding = (
  state: ReviewStatePayload,
  model: Model,
): { readonly visible: ReadonlyArray<ReviewFindingPayload>; readonly selected: ReviewFindingPayload | undefined } => {
  const visible = visibleFindings(state, model);
  return { visible, selected: visible.find((finding) => finding.id === model.selectedFindingId) ?? visible[0] };
};
