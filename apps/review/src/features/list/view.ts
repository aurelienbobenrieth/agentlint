import type { Html, HtmlBuilder } from "foldkit/html";

import type { ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Model, StatusFacet, View } from "../../model";
import { facetCount, type ReviewDerivation, statusFacet, statusFor } from "../../shared/selectors";
import { button, tip } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";
import { relativeTime } from "../../shared/ui/labels";
import { activeChips, searchBar } from "../filters/view";

const statusDot = (status: StatusFacet, authority: ReviewFindingPayload["authority"], h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class(`dot dot--${status === "open" && authority === "human" ? "human" : status}`), h.AriaHidden(true)],
    [],
  );

const findingRow = (
  finding: ReviewFindingPayload,
  state: ReviewStatePayload,
  model: Model,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html => {
  const selected = derived.selected?.id === finding.id;
  const status = statusFacet(statusFor(derived, finding));
  const trailing = model.view === "decisions" ? (finding.acceptance?.at ?? null) : null;
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
          h.span(
            [h.Class("row__meta")],
            [model.groupBy === "rule" && model.view === "queue" ? finding.file : finding.ruleTitle],
          ),
        ],
      ),
      h.span(
        [h.Class("row__trailing")],
        [trailing === null ? `L${finding.line}` : relativeTime(trailing, state.generatedAt)],
      ),
    ],
  );
};

const groupList = (
  state: ReviewStatePayload,
  model: Model,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html => {
  if (derived.visible.length === 0) {
    const filtered = model.query.trim().length > 0 || facetCount(model.facets) > 0;
    return h.div(
      [h.Class("empty")],
      [
        h.div([h.Class("empty__mark")], [icon("check", h)]),
        h.p(
          [],
          [
            filtered
              ? "Nothing matches these filters."
              : model.view === "decisions"
                ? "No accepted findings yet."
                : "Nothing left to decide.",
          ],
        ),
        ...(filtered ? [button("Clear filters", Message.ClearedFacets(), "ghost", h, { size: "sm" })] : []),
      ],
    );
  }
  const byRule = model.groupBy === "rule" && model.view === "queue";
  const keyOf = (finding: ReviewFindingPayload) => (byRule ? finding.ruleId : finding.file);
  const groups = new Map<string, ReviewFindingPayload[]>();
  for (const finding of derived.visible) {
    const key = keyOf(finding);
    const members = groups.get(key);
    if (members === undefined) groups.set(key, [finding]);
    else members.push(finding);
  }
  return h.div(
    [h.Class("list"), h.Role("list")],
    [...groups].map(([key, findings]) =>
      h.keyed("section")(
        key,
        [h.Class("group")],
        [
          h.div(
            [h.Class("group__head")],
            [
              h.span([h.Class("group__title")], [byRule ? (findings[0]?.ruleTitle ?? key) : key]),
              h.span([h.Class("group__count")], [String(findings.length)]),
            ],
          ),
          ...findings.map((finding) => findingRow(finding, state, model, derived, h)),
        ],
      ),
    ),
  );
};

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
      searchBar(state, model, derived, h),
      ...(chips === null ? [] : [chips]),
      groupList(state, model, derived, h),
    ],
  );
};
