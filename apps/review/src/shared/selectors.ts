import { relatedGroups } from "./grouping/related";
import type { FindingStatus, ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Array as A, Match } from "effect";

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
} from "./model";

export const draftFor = ({ model, findingId }: { readonly model: Model; readonly findingId: string }): Draft =>
  model.drafts[findingId] ?? emptyDraft();

export const findingById = ({
  state,
  findingId,
}: {
  readonly state: ReviewStatePayload;
  readonly findingId: string;
}): ReviewFindingPayload | undefined => state.findings.find(({ id }) => id === findingId);

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
const compareText = ({ left, right }: { readonly left: string; readonly right: string }): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Status once local drafts (detached decisions, calibration labels) are applied.
 */
export const effectiveFindingStatus = ({
  finding,
  state,
  model,
}: {
  readonly finding: ReviewFindingPayload;
  readonly state: ReviewStatePayload;
  readonly model: Model;
}): FindingStatus => {
  const draft = draftFor({ model, findingId: finding.id });
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

const inView = ({ status, view }: { readonly status: FindingStatus; readonly view: View }): boolean =>
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

const increment = <K>({ counts, key }: { readonly counts: Map<K, number>; readonly key: K }): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const matchesFacets = ({
  finding,
  status,
  facets,
}: {
  readonly finding: ReviewFindingPayload;
  readonly status: StatusFacet;
  readonly facets: Facets;
}): boolean =>
  (facets.statuses.length === 0 || facets.statuses.includes(status)) &&
  (facets.authorities.length === 0 || facets.authorities.includes(finding.authority)) &&
  (facets.lifecycles.length === 0 || facets.lifecycles.includes(finding.lifecycle)) &&
  (facets.ruleIds.length === 0 || facets.ruleIds.includes(finding.ruleId));

const matchesQuery = ({
  finding,
  query,
}: {
  readonly finding: ReviewFindingPayload;
  readonly query: string;
}): boolean =>
  query.length === 0 ||
  A.some([finding.ruleId, finding.ruleTitle, finding.file, finding.message], (value) =>
    value.toLocaleLowerCase().includes(query),
  );

const groupsOf = ({
  visible,
  related,
  model,
}: {
  readonly visible: ReadonlyArray<ReviewFindingPayload>;
  readonly related: ReadonlyMap<string, string>;
  readonly model: Model;
}): ReadonlyArray<FindingGroup> => {
  const mode = Match.value(model).pipe(
    Match.when({ groupBy: "related" }, () => "related" as const),
    Match.when({ groupBy: "rule", view: "queue" }, () => "rule" as const),
    Match.orElse(() => "file" as const),
  );
  const groups = new Map<string, ReviewFindingPayload[]>();
  for (const finding of visible) {
    const key = Match.value(mode).pipe(
      Match.when("related", () => related.get(finding.id) ?? finding.id),
      Match.when("rule", () => finding.ruleId),
      Match.orElse(() => finding.file),
    );
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [finding]);
    else members.push(finding);
  }
  return A.map([...groups], ([key, findings]) => ({
    key: `${mode}:${key}`,
    label: Match.value(mode).pipe(
      Match.when(
        "related",
        () => `${findings[0]?.file ?? "Related"} · ${new Set(A.map(findings, (finding) => finding.file)).size} file(s)`,
      ),
      Match.when("rule", () => findings[0]?.ruleTitle ?? key),
      Match.orElse(() => key),
    ),
    findings,
  }));
};

type Derived = Omit<ReviewDerivation, "selected" | "selectedIndex">;

const compute = ({ state, model }: { readonly state: ReviewStatePayload; readonly model: Model }): Derived => {
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
  const totals = { queue: 0, open: 0, undecided: 0 };

  for (const finding of state.findings) {
    const status = effectiveFindingStatus({ finding, state, model });
    statusOf.set(finding.id, status);
    titles.set(finding.ruleId, finding.ruleTitle);
    if (status !== "accepted") totals.open += 1;
    if (status === "unresolved") totals.undecided += 1;
    if (inView({ status, view: "queue" })) totals.queue += 1;
    if (!inView({ status, view: model.view })) continue;
    const facet = statusFacet(status);
    increment({ counts: counts.statuses, key: facet });
    increment({ counts: counts.authorities, key: finding.authority });
    increment({ counts: counts.lifecycles, key: finding.lifecycle });
    increment({ counts: counts.rules, key: finding.ruleId });
    if (matchesFacets({ finding, status: facet, facets: model.facets }) && matchesQuery({ finding, query }))
      listed.push(finding);
  }

  const related = relatedGroups(state.findings);
  const visible =
    model.view === "decisions"
      ? listed.toSorted(
          (left, right) =>
            compareText({ left: right.acceptance?.at ?? "", right: left.acceptance?.at ?? "" }) ||
            compareText({ left: left.file, right: right.file }) ||
            left.line - right.line,
        )
      : listed.toSorted((left, right) =>
          Match.value(model.groupBy).pipe(
            Match.when(
              "related",
              () =>
                compareText({ left: related.get(left.id) ?? left.id, right: related.get(right.id) ?? right.id }) ||
                compareText({ left: left.file, right: right.file }) ||
                left.line - right.line,
            ),
            Match.when(
              "rule",
              () =>
                compareText({ left: left.ruleId, right: right.ruleId }) ||
                compareText({ left: left.file, right: right.file }) ||
                left.line - right.line,
            ),
            Match.orElse(
              () =>
                compareText({ left: left.file, right: right.file }) ||
                left.line - right.line ||
                left.column - right.column,
            ),
          ),
        );

  return {
    statusOf,
    related,
    visible,
    groups: groupsOf({ visible, related, model }),
    queueCount: totals.queue,
    decisionsCount: state.findings.length - totals.queue,
    openCount: totals.open,
    undecidedCount: totals.undecided,
    counts,
    rules: [...titles.entries()].toSorted(([left], [right]) => compareText({ left, right })),
  };
};

const cache: {
  last: { readonly inputs: Inputs; readonly result: Derived } | undefined;
  selection:
    | { readonly derived: Derived; readonly selectedFindingId: string | null; readonly result: ReviewDerivation }
    | undefined;
} = { last: undefined, selection: undefined };

/**
 * Memoised on the model fields it reads. `evo` keeps untouched fields referentially stable, so most renders (toasts,
 * resize, hover) hit the cache. The selection is resolved outside that memo so moving through the list never recomputes
 * statuses, groups or the sort.
 */
export const deriveReview = ({
  state,
  model,
}: {
  readonly state: ReviewStatePayload;
  readonly model: Model;
}): ReviewDerivation => {
  const inputs: Inputs = [state, model.drafts, model.view, model.facets, model.groupBy, model.query];
  if (cache.last === undefined || !cache.last.inputs.every((input, index) => input === inputs[index])) {
    cache.last = { inputs, result: compute({ state, model }) };
  }
  const derived = cache.last.result;
  if (cache.selection?.derived === derived && cache.selection.selectedFindingId === model.selectedFindingId) {
    return cache.selection.result;
  }
  const selectedIndex = derived.visible.findIndex((finding) => finding.id === model.selectedFindingId);
  const selected = selectedIndex >= 0 ? derived.visible[selectedIndex] : derived.visible[0];
  const result = { ...derived, selected, selectedIndex: selected === undefined ? -1 : Math.max(0, selectedIndex) };
  cache.selection = { derived, selectedFindingId: model.selectedFindingId, result };
  return result;
};

export const statusFor = ({
  derived,
  finding,
}: {
  readonly derived: ReviewDerivation;
  readonly finding: ReviewFindingPayload;
}): FindingStatus => derived.statusOf.get(finding.id) ?? finding.status;
