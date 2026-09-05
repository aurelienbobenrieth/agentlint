import { createLazy, type Html, type HtmlBuilder } from "foldkit/html";

import type { ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import { Message } from "../../message";
import type { Facets, GroupBy, Model, StatusFacet, View } from "../../model";
import { facetCount, type ReviewDerivation } from "../../shared/selectors";
import { iconButton, tip } from "../../shared/ui/controls";
import { icon } from "../../shared/ui/icons";
import { authorityLabel, lifecycleLabel, statusLabel } from "../../shared/ui/labels";

const facetOption = (label: string, active: boolean, message: Message, h: HtmlBuilder<Message>, count?: number): Html =>
  h.button(
    [
      h.Type("button"),
      h.OnClick(message),
      h.Class(`facet${active ? " facet--active" : ""}`),
      h.AriaPressed(active ? "true" : "false"),
    ],
    [
      h.span([h.Class("facet__box")], [icon("check", h)]),
      h.span([h.Class("facet__label")], [label]),
      ...(count === undefined ? [] : [h.span([h.Class("facet__count")], [String(count)])]),
    ],
  );

const renderFilterPopover = (
  state: ReviewStatePayload,
  facets: Facets,
  view: View,
  groupBy: GroupBy,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html => {
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
                  facetOption(
                    statusLabel(status, state.mode),
                    facets.statuses.includes(status),
                    Message.ToggledStatusFacet({ status }),
                    h,
                    counts.statuses.get(status) ?? 0,
                  ),
                ),
              ],
            ),
          ]),
      h.div(
        [h.Class("popover__section")],
        [
          h.span([h.Class("popover__label")], ["Authority"]),
          ...(["human", "agent"] as const).map((authority) =>
            facetOption(
              authorityLabel(authority),
              facets.authorities.includes(authority),
              Message.ToggledAuthorityFacet({ authority }),
              h,
              counts.authorities.get(authority) ?? 0,
            ),
          ),
        ],
      ),
      h.div(
        [h.Class("popover__section")],
        [
          h.span([h.Class("popover__label")], ["Origin"]),
          ...(["change", "state"] as const).map((lifecycle) =>
            facetOption(
              lifecycleLabel(lifecycle),
              facets.lifecycles.includes(lifecycle),
              Message.ToggledLifecycleFacet({ lifecycle }),
              h,
              counts.lifecycles.get(lifecycle) ?? 0,
            ),
          ),
        ],
      ),
      h.div(
        [h.Class("popover__section popover__section--scroll")],
        [
          h.span([h.Class("popover__label")], ["Rule"]),
          ...derived.rules.map(([ruleId, title]) =>
            facetOption(
              title,
              facets.ruleIds.includes(ruleId),
              Message.ToggledRuleFacet({ ruleId }),
              h,
              counts.rules.get(ruleId) ?? 0,
            ),
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
                  (["file", "rule"] as const).map((option) =>
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(Message.SelectedGroupBy({ groupBy: option })),
                        h.Class(`segment__item${groupBy === option ? " segment__item--active" : ""}`),
                        h.AriaPressed(groupBy === option ? "true" : "false"),
                      ],
                      [option === "file" ? "File" : "Rule"],
                    ),
                  ),
                ),
              ],
            ),
          ]),
    ],
  );
};

/** One slot: the popover renders at a single position. Re-renders only when its inputs change by reference. */
const filterPopover = createLazy();

export const searchBar = (
  state: ReviewStatePayload,
  model: Model,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("search")],
    [
      icon("search", h),
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
            iconButton(
              "Clear search",
              [h.OnClick(Message.UpdatedQuery({ value: "" })), h.Class("icon-btn icon-btn--inline")],
              "x",
              h,
            ),
          ]),
      tip(
        "Filters",
        ["F"],
        h.button(
          [
            h.Type("button"),
            h.Class(`icon-btn icon-btn--inline${facetCount(model.facets) > 0 ? " icon-btn--marked" : ""}`),
            h.AriaLabel("Filters"),
            h.AriaHasPopup("dialog"),
            h.AriaControls("filter-menu"),
            h.Popovertarget("filter-menu"),
          ],
          [icon("filter", h)],
        ),
        h,
      ),
      filterPopover(renderFilterPopover, [state, model.facets, model.view, model.groupBy, derived, h]),
    ],
  );

const chip = (label: string, message: Message, h: HtmlBuilder<Message>): Html =>
  h.button(
    [h.Type("button"), h.OnClick(message), h.Class("chip"), h.AriaLabel(`Remove filter ${label}`)],
    [h.span([], [label]), icon("x", h)],
  );

export const activeChips = (
  state: ReviewStatePayload,
  model: Model,
  derived: ReviewDerivation,
  h: HtmlBuilder<Message>,
): Html | null => {
  if (facetCount(model.facets) === 0) return null;
  const titles = new Map(derived.rules);
  return h.div(
    [h.Class("chips")],
    [
      ...model.facets.statuses.map((status) =>
        chip(statusLabel(status, state.mode), Message.ToggledStatusFacet({ status }), h),
      ),
      ...model.facets.authorities.map((authority) =>
        chip(authority === "human" ? "Human" : "Agent", Message.ToggledAuthorityFacet({ authority }), h),
      ),
      ...model.facets.lifecycles.map((lifecycle) =>
        chip(lifecycle === "change" ? "This change" : "Current code", Message.ToggledLifecycleFacet({ lifecycle }), h),
      ),
      ...model.facets.ruleIds.map((ruleId) =>
        chip(titles.get(ruleId) ?? ruleId, Message.ToggledRuleFacet({ ruleId }), h),
      ),
      h.button([h.Type("button"), h.OnClick(Message.ClearedFacets()), h.Class("chips__clear")], ["Clear"]),
    ],
  );
};
