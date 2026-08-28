import type { FindingStatus, ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";

import {
  emptyDraft,
  type AuthorityFacet,
  type Draft,
  type Facets,
  type GroupBy,
  type LifecycleFacet,
  type Model,
  type StatusFacet,
  type View,
} from "../model";

export const draftFor = (model: Model, findingId: string): Draft => model.drafts[findingId] ?? emptyDraft();

export const findingById = (state: ReviewStatePayload, findingId: string): ReviewFindingPayload | undefined =>
  state.findings.find(({ id }) => id === findingId);

/** Status once local drafts (detached decisions, calibration labels) are applied. */
export const effectiveFindingStatus = (
  finding: ReviewFindingPayload,
  state: ReviewStatePayload,
  model: Model,
): FindingStatus => {
  const draft = draftFor(model, finding.id);
  if (state.mode === "calibration" && draft.calibration !== "unreviewed") return "accepted";
  // Attached sessions refetch server state after every action, so the server is the
  // truth there; a stale local draft must not paint a decision the server no longer holds.
  if (state.transport === "attached") return finding.status;
  if (draft.disposition === "accept") return "accepted";
  if (draft.disposition === "request_changes") return "changes_requested";
  return finding.status;
};

export const statusFacet = (status: FindingStatus): StatusFacet => (status === "unresolved" ? "open" : status);

const inView = (status: FindingStatus, view: View): boolean =>
  view === "decisions" ? status === "accepted" : status !== "accepted";

export const facetCount = (facets: Facets): number =>
  facets.statuses.length + facets.authorities.length + facets.lifecycles.length + facets.ruleIds.length;

/** Everything the review screen reads from findings plus local drafts, computed once per model change. */
export interface ReviewDerivation {
  readonly statusOf: ReadonlyMap<string, FindingStatus>;
  /** The findings the sidebar lists, in display order. */
  readonly visible: ReadonlyArray<ReviewFindingPayload>;
  /** The finding the detail pane shows: the selected one if listed, else the first listed. */
  readonly selected: ReviewFindingPayload | undefined;
  /** Index of `selected` in `visible`, or -1. */
  readonly selectedIndex: number;
  readonly queueCount: number;
  readonly decisionsCount: number;
  /** Findings still unresolved. Zero means the gate is open. */
  readonly openCount: number;
  /** Facet option counts within the current view, before facets and the query apply. */
  readonly counts: {
    readonly statuses: ReadonlyMap<StatusFacet, number>;
    readonly authorities: ReadonlyMap<AuthorityFacet, number>;
    readonly lifecycles: ReadonlyMap<LifecycleFacet, number>;
    readonly rules: ReadonlyMap<string, number>;
  };
  /** Every rule in the review as `[ruleId, title]`, sorted by id. */
  readonly rules: ReadonlyArray<readonly [string, string]>;
}

type Inputs = readonly [ReviewStatePayload, Model["drafts"], View, Facets, GroupBy, string, string | null];

const increment = <K>(counts: Map<K, number>, key: K): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const matchesFacets = (finding: ReviewFindingPayload, status: StatusFacet, facets: Facets): boolean =>
  (facets.statuses.length === 0 || facets.statuses.includes(status)) &&
  (facets.authorities.length === 0 || facets.authorities.includes(finding.authority)) &&
  (facets.lifecycles.length === 0 || facets.lifecycles.includes(finding.lifecycle)) &&
  (facets.ruleIds.length === 0 || facets.ruleIds.includes(finding.ruleId));

const matchesQuery = (finding: ReviewFindingPayload, query: string): boolean =>
  query.length === 0 ||
  [finding.ruleId, finding.ruleTitle, finding.file, finding.message].some((value) =>
    value.toLocaleLowerCase().includes(query),
  );

const compute = (state: ReviewStatePayload, model: Model): ReviewDerivation => {
  const statusOf = new Map<string, FindingStatus>();
  const counts = {
    statuses: new Map<StatusFacet, number>(),
    authorities: new Map<AuthorityFacet, number>(),
    lifecycles: new Map<LifecycleFacet, number>(),
    rules: new Map<string, number>(),
  };
  const titles = new Map<string, string>();
  const query = model.query.trim().toLocaleLowerCase();
  const listed: ReviewFindingPayload[] = [];
  let queueCount = 0;
  let openCount = 0;

  for (const finding of state.findings) {
    const status = effectiveFindingStatus(finding, state, model);
    statusOf.set(finding.id, status);
    titles.set(finding.ruleId, finding.ruleTitle);
    if (status === "unresolved") openCount += 1;
    if (inView(status, "queue")) queueCount += 1;
    if (!inView(status, model.view)) continue;
    const facet = statusFacet(status);
    increment(counts.statuses, facet);
    increment(counts.authorities, finding.authority);
    increment(counts.lifecycles, finding.lifecycle);
    increment(counts.rules, finding.ruleId);
    if (matchesFacets(finding, facet, model.facets) && matchesQuery(finding, query)) listed.push(finding);
  }

  const visible =
    model.view === "decisions"
      ? listed.toSorted(
          (left, right) =>
            (right.acceptance?.at ?? "").localeCompare(left.acceptance?.at ?? "") ||
            left.file.localeCompare(right.file) ||
            left.line - right.line,
        )
      : listed.toSorted((left, right) =>
          model.groupBy === "rule"
            ? left.ruleId.localeCompare(right.ruleId) || left.file.localeCompare(right.file) || left.line - right.line
            : left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column,
        );
  const selectedIndex = visible.findIndex((finding) => finding.id === model.selectedFindingId);
  const selected = selectedIndex >= 0 ? visible[selectedIndex] : visible[0];

  return {
    statusOf,
    visible,
    selected,
    selectedIndex: selected === undefined ? -1 : Math.max(0, selectedIndex),
    queueCount,
    decisionsCount: state.findings.length - queueCount,
    openCount,
    counts,
    rules: [...titles.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
  };
};

let last: { readonly inputs: Inputs; readonly result: ReviewDerivation } | undefined;

/** Memoised on the model fields it reads. `evo` keeps untouched fields referentially stable, so most
 *  renders (toasts, resize, hover) hit the cache. */
export const deriveReview = (state: ReviewStatePayload, model: Model): ReviewDerivation => {
  const inputs: Inputs = [
    state,
    model.drafts,
    model.view,
    model.facets,
    model.groupBy,
    model.query,
    model.selectedFindingId,
  ];
  if (last !== undefined && last.inputs.every((input, index) => input === inputs[index])) return last.result;
  const result = compute(state, model);
  last = { inputs, result };
  return result;
};

export const statusFor = (derived: ReviewDerivation, finding: ReviewFindingPayload): FindingStatus =>
  derived.statusOf.get(finding.id) ?? finding.status;
