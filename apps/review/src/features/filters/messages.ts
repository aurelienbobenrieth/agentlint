import { Schema as S } from "effect";

import { AuthorityFacet, GroupBy, LifecycleFacet, StatusFacet } from "../../model";

export const fields = {
  ToggledStatusFacet: { status: StatusFacet },
  ToggledAuthorityFacet: { authority: AuthorityFacet },
  ToggledRuleFacet: { ruleId: S.String },
  ToggledLifecycleFacet: { lifecycle: LifecycleFacet },
  ClearedFacets: {},
  SelectedGroupBy: { groupBy: GroupBy },
  UpdatedQuery: { value: S.String },
} satisfies Record<string, S.Struct.Fields>;
