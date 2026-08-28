import { evo } from "foldkit/struct";

import type { Model } from "../../model";
import type { Handlers } from "../../shared/update";
import { persistChange } from "../session/update";
import type { fields } from "./messages";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  SelectedView: ({ view }) =>
    persistChange(model, (current) => evo(current, { view: () => view, selectedFindingId: () => null })),
  SelectedFinding: ({ findingId }) =>
    persistChange(model, (current) => evo(current, { selectedFindingId: () => findingId })),
});
