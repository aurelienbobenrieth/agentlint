import { evo } from "foldkit/struct";

import { emptyFacets, type Model } from "../../model";
import { type Handlers, toggle } from "../../shared/update";
import { persistChange, persistLater } from "../session/update";
import type { fields } from "./messages";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  ToggledStatusFacet: ({ status }) =>
    persistChange(model, (current) =>
      evo(current, { facets: (facets) => ({ ...facets, statuses: toggle(facets.statuses, status) }) }),
    ),
  ToggledAuthorityFacet: ({ authority }) =>
    persistChange(model, (current) =>
      evo(current, { facets: (facets) => ({ ...facets, authorities: toggle(facets.authorities, authority) }) }),
    ),
  ToggledLifecycleFacet: ({ lifecycle }) =>
    persistChange(model, (current) =>
      evo(current, { facets: (facets) => ({ ...facets, lifecycles: toggle(facets.lifecycles, lifecycle) }) }),
    ),
  ToggledRuleFacet: ({ ruleId }) =>
    persistChange(model, (current) =>
      evo(current, { facets: (facets) => ({ ...facets, ruleIds: toggle(facets.ruleIds, ruleId) }) }),
    ),
  ClearedFacets: () => persistChange(model, (current) => evo(current, { facets: () => emptyFacets() })),
  SelectedGroupBy: ({ groupBy }) => persistChange(model, (current) => evo(current, { groupBy: () => groupBy })),
  UpdatedQuery: ({ value }) => persistLater(evo(model, { query: () => value })),
});
