import { evo } from "foldkit/struct";

import type { Model } from "../../model";
import { deriveReview } from "../../shared/selectors";
import type { Handlers } from "../../shared/update";
import { persistChange } from "../session/update";
import type { fields } from "./messages";
import { selectFinding } from "./selection";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  SelectedView: ({ view }) =>
    persistChange(model, (current) => {
      const switched = evo(current, { view: () => view });
      const first =
        switched.screen._tag === "Reviewing" ? deriveReview(switched.screen.state, switched).visible[0] : undefined;
      return selectFinding(switched, first?.id ?? null);
    }),
  SelectedFinding: ({ findingId }) =>
    persistChange(model, (current) => evo(selectFinding(current, findingId), { sidebarOpen: () => true })),
  SettledSelection: ({ version }) =>
    version === model.selectionVersion ? { model: evo(model, { selectionSettled: () => true }) } : { model },
});
