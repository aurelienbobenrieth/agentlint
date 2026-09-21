import { relatedGroups } from "../features/list/groups";
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

/**
 * Selection, drafts and exports all key on the finding id, so a state that repeats one cannot be reviewed safely: the
 * reviewer would see one finding and export a decision for both.
 */
export const duplicateFindingId = (state: ReviewStatePayload): string | null => {
  const seen = new Set<string>();
  for (const { id } of state.findings) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
};

/**
 * Code-unit order, matching the order the package emits. `localeCompare` varies with the browser locale.
 */
const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Status once local drafts (detached decisions, calibration labels) are applied.
 */
export const effectiveFindingStatus = (
  finding: ReviewFindingPayload,
  state: ReviewStatePayload,
  model: Model,
): FindingStatus => {
  const draft = draftFor(model, finding.id);
  if (state.mode === "calibration")
    return state.transport === "attached" ? finding.status : draft.disposition === "accept" ? "accepted" : "unresolved";
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

export interface FindingGroup {
  /**
   * Unique across grouping modes, so it can key both the DOM and a render memo.
   */
  readonly key: string;
  readonly label: string;
  readonly findings: ReadonlyArray<ReviewFindingPayload>;
}

/**
 * Everything the review screen reads from findings plus local drafts, computed once per model change.
 */
export interface ReviewDerivation {
  readonly statusOf: ReadonlyMap<string, FindingStatus>;
  /**
   * The findings the sidebar lists, in display order.
   */
  readonly related: ReadonlyMap<string, string>;
  readonly visible: ReadonlyArray<ReviewFindingPayload>;
  /**
   * `visible` split into the sidebar's groups, in display order.
   */
  readonly groups: ReadonlyArray<FindingGroup>;
  /**
   * The finding the detail pane shows: the selected one if listed, else the first listed.
   */
  readonly selected: ReviewFindingPayload | undefined;
  /**
   * Index of `selected` in `visible`, or -1.
   */
  readonly selectedIndex: number;
  readonly queueCount: number;
  readonly decisionsCount: number;
  /**
   * Findings still unresolved. Zero means the gate is open.
   */
  readonly openCount: number;
  readonly undecidedCount: number;
  /**
   * Facet option counts within the current view, before facets and the query apply.
   */
  readonly counts: {
    readonly statuses: ReadonlyMap<StatusFacet, number>;
    readonly authorities: ReadonlyMap<AuthorityFacet, number>;
    readonly lifecycles: ReadonlyMap<LifecycleFacet, number>;
    readonly rules: ReadonlyMap<string, number>;
  };
  /**
   * Every rule in the review as `[ruleId, title]`, sorted by id.
   */
  readonly rules: ReadonlyArray<readonly [string, string]>;
}

type Inputs = readonly [ReviewStatePayload, Model["drafts"], View, Facets, GroupBy, string];

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

const groupsOf = (
  visible: ReadonlyArray<ReviewFindingPayload>,
  related: ReadonlyMap<string, string>,
  model: Model,
): ReadonlyArray<FindingGroup> => {
  const mode =
    model.groupBy === "related" ? "related" : model.groupBy === "rule" && model.view === "queue" ? "rule" : "file";
  const groups = new Map<string, ReviewFindingPayload[]>();
  for (const finding of visible) {
    const key =
      mode === "related" ? (related.get(finding.id) ?? finding.id) : mode === "rule" ? finding.ruleId : finding.file;
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [finding]);
    else members.push(finding);
  }
  return [...groups].map(([key, findings]) => ({
    key: `${mode}:${key}`,
    label:
      mode === "related"
        ? `${findings[0]?.file ?? "Related"} · ${new Set(findings.map((finding) => finding.file)).size} file(s)`
        : mode === "rule"
          ? (findings[0]?.ruleTitle ?? key)
          : key,
    findings,
  }));
};

type Derived = Omit<ReviewDerivation, "selected" | "selectedIndex">;

const compute = (state: ReviewStatePayload, model: Model): Derived => {
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
  let undecidedCount = 0;

  for (const finding of state.findings) {
    const status = effectiveFindingStatus(finding, state, model);
    statusOf.set(finding.id, status);
    titles.set(finding.ruleId, finding.ruleTitle);
    if (status !== "accepted") openCount += 1;
    if (status === "unresolved") undecidedCount += 1;
    if (inView(status, "queue")) queueCount += 1;
    if (!inView(status, model.view)) continue;
    const facet = statusFacet(status);
    increment(counts.statuses, facet);
    increment(counts.authorities, finding.authority);
    increment(counts.lifecycles, finding.lifecycle);
    increment(counts.rules, finding.ruleId);
    if (matchesFacets(finding, facet, model.facets) && matchesQuery(finding, query)) listed.push(finding);
  }

  const related = relatedGroups(state.findings);
  const visible =
    model.view === "decisions"
      ? listed.toSorted(
          (left, right) =>
            compareText(right.acceptance?.at ?? "", left.acceptance?.at ?? "") ||
            compareText(left.file, right.file) ||
            left.line - right.line,
        )
      : listed.toSorted((left, right) =>
          model.groupBy === "related"
            ? compareText(related.get(left.id) ?? left.id, related.get(right.id) ?? right.id) ||
              compareText(left.file, right.file) ||
              left.line - right.line
            : model.groupBy === "rule"
              ? compareText(left.ruleId, right.ruleId) || compareText(left.file, right.file) || left.line - right.line
              : compareText(left.file, right.file) || left.line - right.line || left.column - right.column,
        );

  return {
    statusOf,
    related,
    visible,
    groups: groupsOf(visible, related, model),
    queueCount,
    decisionsCount: state.findings.length - queueCount,
    openCount,
    undecidedCount,
    counts,
    rules: [...titles.entries()].toSorted(([left], [right]) => compareText(left, right)),
  };
};

let last: { readonly inputs: Inputs; readonly result: Derived } | undefined;
let lastSelection:
  | { readonly derived: Derived; readonly selectedFindingId: string | null; readonly result: ReviewDerivation }
  | undefined;

/**
 * Memoised on the model fields it reads. `evo` keeps untouched fields referentially stable, so most renders (toasts,
 * resize, hover) hit the cache. The selection is resolved outside that memo so moving through the list never recomputes
 * statuses, groups or the sort.
 */
export const deriveReview = (state: ReviewStatePayload, model: Model): ReviewDerivation => {
  const inputs: Inputs = [state, model.drafts, model.view, model.facets, model.groupBy, model.query];
  if (last === undefined || !last.inputs.every((input, index) => input === inputs[index])) {
    last = { inputs, result: compute(state, model) };
  }
  const derived = last.result;
  if (lastSelection?.derived === derived && lastSelection.selectedFindingId === model.selectedFindingId) {
    return lastSelection.result;
  }
  const selectedIndex = derived.visible.findIndex((finding) => finding.id === model.selectedFindingId);
  const selected = selectedIndex >= 0 ? derived.visible[selectedIndex] : derived.visible[0];
  const result = { ...derived, selected, selectedIndex: selected === undefined ? -1 : Math.max(0, selectedIndex) };
  lastSelection = { derived, selectedFindingId: model.selectedFindingId, result };
  return result;
};

export const statusFor = (derived: ReviewDerivation, finding: ReviewFindingPayload): FindingStatus =>
  derived.statusOf.get(finding.id) ?? finding.status;
