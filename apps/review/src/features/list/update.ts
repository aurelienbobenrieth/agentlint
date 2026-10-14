import { modifyFields } from "foldkit/struct";

import type { Model } from "../../shared/model";
import { deriveReview } from "../../shared/selectors";
import type { Handlers } from "../../shared/update";
import { persistChange } from "../session/update";
import type { fields } from "./messages";
import { selectFinding } from "./selection";
import { RevealFinding } from "./command";
import { appendCommands } from "../../shared/update";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  FocusedFinding: ({ findingId }) =>
    findingId === model.selectedFindingId
      ? { model }
      : {
          model: modifyFields(model, {
            selectedFindingId: () => findingId,
            selectionSettled: () => true,
            selectionVersion: (version) => version + 1,
          }),
        },
  SelectedView: ({ view }) =>
    persistChange({
      model,
      change: (current) => {
        const switched = modifyFields(current, { view: () => view, retainedFindingIds: () => [] });
        const first =
          switched.screen._tag === "Reviewing"
            ? deriveReview({ state: switched.screen.state, model: switched }).visible[0]
            : undefined;
        return selectFinding({ model: switched, findingId: first?.id ?? null });
      },
    }),
  SelectedFinding: ({ findingId }) =>
    appendCommands({
      result: persistChange({
        model,
        change: (current) => modifyFields(selectFinding({ model: current, findingId }), { sidebarOpen: () => true }),
      }),
      commands: [RevealFinding({ findingId })],
    }),
  SettledSelection: ({ version }) =>
    version === model.selectionVersion ? { model: modifyFields(model, { selectionSettled: () => true }) } : { model },
});
