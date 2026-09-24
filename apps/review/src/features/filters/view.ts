import { createLazy, type Html, type HtmlBuilder } from "foldkit/html";

import type { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Facets, GroupBy, Model, StatusFacet, View } from "../../shared/model";
import { facetCount, type ReviewDerivation } from "../../shared/selectors";
import { iconButton, tip } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";
import { authorityLabel, lifecycleLabel, statusLabel } from "../../shared/ui/labels";

const facetOption = ({
  label,
  active,
  message,
  h,
  count,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly message: Message;
  readonly h: HtmlBuilder<Message>;
  readonly count?: number;
}): Html =>
  h.button(
    [
      h.Type("button"),
      h.OnClick(message),
      h.Class(`facet${active ? " facet--active" : ""}`),
      h.AriaPressed(active ? "true" : "false"),
    ],
    [
      h.span([h.Class("facet__box")], [icon({ name: "check", h })]),
      h.span([h.Class("facet__label")], [label]),
      ...(count === undefined ? [] : [h.span([h.Class("facet__count")], [String(count)])]),
    ],
  );

const renderFilterPopover = ({
  state,
  facets,
  view,
  groupBy,
  derived,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly facets: Facets;
  readonly view: View;
  readonly groupBy: GroupBy;
  readonly derived: ReviewDerivation;
  readonly h: HtmlBuilder<Message>;
}): Html => {
  const { counts } = derived;
  const statuses: ReadonlyArray<StatusFacet> = view === "decisions" ? [] : ["open", "changes_requested"];
  return h.div(
    [h.Id("filter-menu"), h.Class("popover popover--filters"), h.Popover("auto")],
    [
      ...(statuses.length === 0
        ? []
        : [
            h.div(
              [h.Class("popover__section")],
              [
                h.span([h.Class("popover__label")], ["Status"]),
                ...statuses.map((status) =>
                  facetOption({
                    label: statusLabel({ status, mode: state.mode }),
                    active: facets.statuses.includes(status),
                    message: Message.ToggledStatusFacet({ status }),
                    h,
                    count: counts.statuses.get(status) ?? 0,
                  }),
                ),
              ],
            ),
          ]),
      h.div(
        [h.Class("popover__section")],
        [
          h.span([h.Class("popover__label")], ["Authority"]),
          ...(["human", "agent"] as const).map((authority) =>
            facetOption({
              label: authorityLabel(authority),
              active: facets.authorities.includes(authority),
              message: Message.ToggledAuthorityFacet({ authority }),
              h,
              count: counts.authorities.get(authority) ?? 0,
            }),
          ),
        ],
      ),
      h.div(
        [h.Class("popover__section")],
        [
          h.span([h.Class("popover__label")], ["Origin"]),
          ...(["change", "state"] as const).map((lifecycle) =>
            facetOption({
              label: lifecycleLabel(lifecycle),
              active: facets.lifecycles.includes(lifecycle),
              message: Message.ToggledLifecycleFacet({ lifecycle }),
              h,
              count: counts.lifecycles.get(lifecycle) ?? 0,
            }),
          ),
        ],
      ),
      h.div(
        [h.Class("popover__section popover__section--scroll")],
        [
          h.span([h.Class("popover__label")], ["Rule"]),
          ...derived.rules.map(([ruleId, title]) =>
            facetOption({
              label: title,
              active: facets.ruleIds.includes(ruleId),
              message: Message.ToggledRuleFacet({ ruleId }),
              h,
              count: counts.rules.get(ruleId) ?? 0,
            }),
          ),
        ],
      ),
      ...(view === "decisions"
        ? []
        : [
            h.div(
              [h.Class("popover__section popover__section--row")],
              [
                h.span([h.Class("popover__label")], ["Group by"]),
                h.div(
                  [h.Class("segment segment--sm")],
                  (["file", "rule", "related"] as const).map((option) =>
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(Message.SelectedGroupBy({ groupBy: option })),
                        h.Class(`segment__item${groupBy === option ? " segment__item--active" : ""}`),
                        h.AriaPressed(groupBy === option ? "true" : "false"),
                      ],
                      [option === "file" ? "File" : option === "rule" ? "Rule" : "Related"],
                    ),
                  ),
                ),
              ],
            ),
          ]),
    ],
  );
};

/**
 * One slot: the popover renders at a single position. Re-renders only when its inputs change by reference.
 */
const filterPopover = createLazy();

export const searchBar = ({
  state,
  model,
  derived,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly model: Model;
  readonly derived: ReviewDerivation;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.div(
    [h.Class("search")],
    [
      icon({ name: "search", h }),
      h.input([
        h.Type("search"),
        h.Class("search__input"),
        h.Value(model.query),
        h.Placeholder("Search"),
        h.AriaLabel("Search findings"),
        h.OnInput((value) => Message.UpdatedQuery({ value })),
      ]),
      ...(model.query.length === 0
        ? []
        : [
            iconButton({
              label: "Clear search",
              attributes: [h.OnClick(Message.UpdatedQuery({ value: "" })), h.Class("icon-btn icon-btn--inline")],
              name: "x",
              h,
            }),
          ]),
      tip({
        label: "Filters",
        keys: ["F"],
        trigger: h.button(
          [
            h.Type("button"),
            h.Class(`icon-btn icon-btn--inline${facetCount(model.facets) > 0 ? " icon-btn--marked" : ""}`),
            h.AriaLabel("Filters"),
            h.AriaHasPopup("dialog"),
            h.AriaControls("filter-menu"),
            h.Popovertarget("filter-menu"),
          ],
          [icon({ name: "filter", h })],
        ),
        h,
      }),
      filterPopover(
        (
          popoverState: ReviewStatePayload,
          facets: Facets,
          view: View,
          groupBy: GroupBy,
          popoverDerived: ReviewDerivation,
          builder: HtmlBuilder<Message>,
        ) =>
          renderFilterPopover({
            state: popoverState,
            facets,
            view,
            groupBy,
            derived: popoverDerived,
            h: builder,
          }),
        [state, model.facets, model.view, model.groupBy, derived, h],
      ),
    ],
  );

const chip = ({
  label,
  message,
  h,
}: {
  readonly label: string;
  readonly message: Message;
  readonly h: HtmlBuilder<Message>;
}): Html =>
  h.button(
    [h.Type("button"), h.OnClick(message), h.Class("chip"), h.AriaLabel(`Remove filter ${label}`)],
    [h.span([], [label]), icon({ name: "x", h })],
  );

export const activeChips = ({
  state,
  model,
  derived,
  h,
}: {
  readonly state: ReviewStatePayload;
  readonly model: Model;
  readonly derived: ReviewDerivation;
  readonly h: HtmlBuilder<Message>;
}): Html | null => {
  if (facetCount(model.facets) === 0) return null;
  const titles = new Map(derived.rules);
  return h.div(
    [h.Class("chips")],
    [
      ...model.facets.statuses.map((status) =>
        chip({ label: statusLabel({ status, mode: state.mode }), message: Message.ToggledStatusFacet({ status }), h }),
      ),
      ...model.facets.authorities.map((authority) =>
        chip({
          label: authority === "human" ? "Human" : "Agent",
          message: Message.ToggledAuthorityFacet({ authority }),
          h,
        }),
      ),
      ...model.facets.lifecycles.map((lifecycle) =>
        chip({
          label: lifecycle === "change" ? "This change" : "Current code",
          message: Message.ToggledLifecycleFacet({ lifecycle }),
          h,
        }),
      ),
      ...model.facets.ruleIds.map((ruleId) =>
        chip({ label: titles.get(ruleId) ?? ruleId, message: Message.ToggledRuleFacet({ ruleId }), h }),
      ),
      h.button([h.Type("button"), h.OnClick(Message.ClearedFacets()), h.Class("chips__clear")], ["Clear"]),
    ],
  );
};
