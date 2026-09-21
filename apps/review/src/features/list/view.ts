import { calibrationPanel } from "../calibration/view";
import { createKeyedLazy, createLazy, type Html, type HtmlBuilder } from "foldkit/html";

import type { ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model, StatusFacet, View } from "../../model";
import { facetCount, type FindingGroup, type ReviewDerivation, statusFacet } from "../../shared/selectors";
import { button, tip } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";
import { relativeTime } from "../../shared/ui/labels";
import { activeChips, searchBar } from "../filters/view";

const statusDot = (status: StatusFacet, authority: ReviewFindingPayload["authority"], h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class(`dot dot--${status === "open" && authority === "human" ? "human" : status}`), h.AriaHidden(true)],
    [],
  );

/** What a row reads besides its finding. Every field is referentially stable across renders that do not
 *  change it, so the group memo below holds through toasts, typing and resizing. */
interface RowContext {
  readonly statusOf: ReviewDerivation["statusOf"];
  readonly view: View;
  readonly byRule: boolean;
  readonly generatedAt: string;
}

const findingRow = (
  finding: ReviewFindingPayload,
  selected: boolean,
  context: RowContext,
  h: HtmlBuilder<Message>,
): Html => {
  const status = statusFacet(context.statusOf.get(finding.id) ?? finding.status);
  const trailing = context.view === "decisions" ? (finding.acceptance?.at ?? null) : null;
  return h.keyed("button")(
    finding.id,
    [
      h.Type("button"),
      h.OnClick(Message.SelectedFinding({ findingId: finding.id })),
      h.Class(`row${selected ? " row--selected" : ""}`),
      ...(selected ? [h.AriaCurrent("true")] : []),
    ],
    [
      statusDot(status, finding.authority, h),
      h.span(
        [h.Class("row__body")],
        [
          h.span([h.Class("row__title")], [finding.message]),
          h.span([h.Class("row__meta")], [context.byRule ? finding.file : finding.ruleTitle]),
        ],
      ),
      h.span(
        [h.Class("row__trailing")],
        [trailing === null ? `L${finding.line}` : relativeTime(trailing, context.generatedAt)],
      ),
    ],
  );
};

const renderGroup = (
  group: FindingGroup,
  selectedId: string | null,
  statusOf: RowContext["statusOf"],
  view: View,
  byRule: boolean,
  generatedAt: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed("section")(
    group.key,
    [h.Class("group"), h.Role("group"), h.AriaLabel(group.label)],
    [
      h.div(
        [
          h.Class("group__head"),
          h.Title(
            group.key.startsWith("related:")
              ? [...new Set(group.findings.flatMap((finding) => finding.relatedFiles))].join(", ")
              : group.label,
          ),
        ],
        [
          h.span([h.Class("group__title")], [group.label]),
          h.span([h.Class("group__count")], [String(group.findings.length)]),
        ],
      ),
      ...group.findings.map((finding) =>
        findingRow(finding, finding.id === selectedId, { statusOf, view, byRule, generatedAt }, h),
      ),
    ],
  );

/** One memo slot per group: moving the selection re-renders the group it left and the one it entered,
 *  not the whole queue. Keys are group keys, bounded by the review. Rendering every row is still linear
 *  in the queue on the first paint; virtualising the list is a follow-up. */
const lazyGroup = createKeyedLazy();

const renderGroupList = (
  groups: ReviewDerivation["groups"],
  selectedId: string | null,
  statusOf: RowContext["statusOf"],
  view: View,
  byRule: boolean,
  filtered: boolean,
  generatedAt: string,
  h: HtmlBuilder<Message>,
): Html => {
  if (groups.length === 0) {
    return h.div(
      [h.Class("empty")],
      [
        h.div([h.Class("empty__mark")], [icon("check", h)]),
        h.p(
          [],
          [
            filtered
              ? "Nothing matches these filters."
              : view === "decisions"
                ? "No accepted findings yet."
                : "Nothing left to decide.",
          ],
        ),
        ...(filtered ? [button("Clear filters", Message.ClearedFacets(), "ghost", h, { size: "sm" })] : []),
      ],
    );
  }
  return h.div(
    [h.Class("list")],
    groups.map((group) =>
      lazyGroup(group.key, renderGroup, [
        group,
        group.findings.some(({ id }) => id === selectedId) ? selectedId : null,
        statusOf,
        view,
        byRule,
        generatedAt,
        h,
      ]),
    ),
  );
};

const lazyGroupList = createLazy();

const groupList = (state: ReviewStatePayload, model: Model, derived: ReviewDerivation, h: HtmlBuilder<Message>): Html =>
  lazyGroupList(renderGroupList, [
    derived.groups,
    derived.selected?.id ?? null,
    derived.statusOf,
    model.view,
    model.groupBy === "rule" && model.view === "queue",
    model.query.trim().length > 0 || facetCount(model.facets) > 0,
    state.generatedAt,
    h,
  ]);

export const sidebar = (
  state: ReviewStatePayload,
  model: Model,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html => {
  const tab = (view: View, label: string, count: number, key: string) =>
    tip(
      label,
      [key],
      h.button(
        [
          h.Type("button"),
          h.OnClick(Message.SelectedView({ view })),
          h.Class(`tab${model.view === view ? " tab--active" : ""}`),
          h.AriaPressed(model.view === view ? "true" : "false"),
        ],
        [h.span([], [label]), h.span([h.Class("tab__count")], [String(count)])],
      ),
      h,
    );
  const chips = activeChips(state, model, derived, h);
  return h.aside(
    [h.Class("sidebar")],
    [
      h.div(
        [h.Class("tabs")],
        [tab("queue", "Queue", derived.queueCount, "1"), tab("decisions", "Decisions", derived.decisionsCount, "2")],
      ),
      ...(state.mode === "review"
        ? [
            h.button(
              [
                h.Type("button"),
                h.Class("independent-toggle"),
                h.AriaPressed(model.independentReview ? "true" : "false"),
                h.OnClick(Message.ToggledIndependentReview()),
                h.Title(
                  "Write your own assessment before revealing existing justifications. Session-only presentation mode.",
                ),
              ],
              [model.independentReview ? "Independent review · on" : "Independent review"],
            ),
          ]
        : []),
      searchBar(state, model, derived, h),
      ...(chips === null ? [] : [chips]),
      ...(state.mode === "calibration" ? [calibrationPanel(state, model, h)] : []),
      groupList(state, model, derived, h),
    ],
  );
};
