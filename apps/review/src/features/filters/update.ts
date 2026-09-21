import { evo } from "foldkit/struct";

import { emptyFacets, type Model } from "../../model";
import { appendCommands, type Handlers, toggle, type UpdateReturn } from "../../shared/update";
import { reconcileSelection } from "../list/selection";
import { persist, persistLater } from "../session/update";
import type { fields } from "./messages";

export const cases = (model: Model): Handlers<keyof typeof fields> => {
  /** A filter can hide the selected finding; the selection then moves to one that is still listed. */
  const refilter = (change: (model: Model) => Model, save: (model: Model) => UpdateReturn = persist): UpdateReturn => {
    const reconciled = reconcileSelection(model, change(model));
    return appendCommands(save(reconciled.model), reconciled.commands ?? []);
  };
  return {
    ToggledStatusFacet: ({ status }) =>
      refilter((current) =>
        evo(current, { facets: (facets) => ({ ...facets, statuses: toggle(facets.statuses, status) }) }),
      ),
    ToggledAuthorityFacet: ({ authority }) =>
      refilter((current) =>
        evo(current, { facets: (facets) => ({ ...facets, authorities: toggle(facets.authorities, authority) }) }),
      ),
    ToggledLifecycleFacet: ({ lifecycle }) =>
      refilter((current) =>
        evo(current, { facets: (facets) => ({ ...facets, lifecycles: toggle(facets.lifecycles, lifecycle) }) }),
      ),
    ToggledRuleFacet: ({ ruleId }) =>
      refilter((current) =>
        evo(current, { facets: (facets) => ({ ...facets, ruleIds: toggle(facets.ruleIds, ruleId) }) }),
      ),
    ClearedFacets: () => refilter((current) => evo(current, { facets: () => emptyFacets() })),
    SelectedGroupBy: ({ groupBy }) => refilter((current) => evo(current, { groupBy: () => groupBy })),
    UpdatedQuery: ({ value }) => refilter((current) => evo(current, { query: () => value }), persistLater),
  };
};
