import { evo } from "foldkit/struct";

import { emptyFacets, type Model } from "../../shared/model";
import { appendCommands, type Handlers, toggle, type UpdateReturn } from "../../shared/update";
import { reconcileSelection } from "../list/selection";
import { persist, persistLater } from "../session/update";
import type { fields } from "./messages";

export const cases = (model: Model): Handlers<keyof typeof fields> => {
  /**
   * A filter can hide the selected finding; the selection then moves to one that is still listed.
   */
  const refilter = ({
    change,
    save = persist,
  }: {
    readonly change: (model: Model) => Model;
    readonly save?: (model: Model) => UpdateReturn;
  }): UpdateReturn => {
    const reconciled = reconcileSelection({ before: model, after: change(model) });
    return appendCommands({ result: save(reconciled.model), commands: reconciled.commands ?? [] });
  };
  return {
    ToggledStatusFacet: ({ status }) =>
      refilter({
        change: (current) =>
          evo(current, {
            facets: (facets) => ({ ...facets, statuses: toggle({ values: facets.statuses, value: status }) }),
          }),
      }),
    ToggledAuthorityFacet: ({ authority }) =>
      refilter({
        change: (current) =>
          evo(current, {
            facets: (facets) => ({ ...facets, authorities: toggle({ values: facets.authorities, value: authority }) }),
          }),
      }),
    ToggledLifecycleFacet: ({ lifecycle }) =>
      refilter({
        change: (current) =>
          evo(current, {
            facets: (facets) => ({ ...facets, lifecycles: toggle({ values: facets.lifecycles, value: lifecycle }) }),
          }),
      }),
    ToggledRuleFacet: ({ ruleId }) =>
      refilter({
        change: (current) =>
          evo(current, {
            facets: (facets) => ({ ...facets, ruleIds: toggle({ values: facets.ruleIds, value: ruleId }) }),
          }),
      }),
    ClearedFacets: () => refilter({ change: (current) => evo(current, { facets: () => emptyFacets() }) }),
    SelectedGroupBy: ({ groupBy }) => refilter({ change: (current) => evo(current, { groupBy: () => groupBy }) }),
    UpdatedQuery: ({ value }) =>
      refilter({ change: (current) => evo(current, { query: () => value }), save: persistLater }),
  };
};
