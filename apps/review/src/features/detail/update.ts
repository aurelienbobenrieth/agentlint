import { evo } from "foldkit/struct";

import type { Model } from "../../model";
import { draftFor, findingById } from "../../shared/selectors";
import { appendCommands, type Handlers } from "../../shared/update";
import { persistChange } from "../session/update";
import { enqueueToast } from "../toasts/update";
import { CopyText, OpenEditor } from "./command";
import type { fields } from "./messages";
import { findingContext } from "./selectors";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  ToggledIndependentReview: () => ({
    model: evo(model, {
      independentReview: (active) => !active,
      revealedFindings: () => [],
      independentNotes: () => ({}),
    }),
  }),
  UpdatedIndependentNote: ({ findingId, value }) => ({
    model: evo(model, { independentNotes: (notes) => ({ ...notes, [findingId]: value }) }),
  }),
  RevealedPriorDecision: ({ findingId }) => {
    const note = model.independentNotes[findingId]?.trim();
    if (!note) return { model };
    return persistChange({
      model,
      change: (current) =>
        evo(current, {
          revealedFindings: (ids) => [...new Set([...ids, findingId])],
          drafts: (drafts) => ({
            ...drafts,
            [findingId]: { ...draftFor({ model: current, findingId }), reason: note },
          }),
        }),
    });
  },
  SelectedCodeView: ({ codeView }) =>
    persistChange({ model, change: (current) => evo(current, { codeView: () => codeView }) }),
  ToggledGuidance: () => persistChange({ model, change: (current) => evo(current, { guidanceOpen: (open) => !open }) }),
  SetGuidanceOpen: ({ open }) =>
    open === model.guidanceOpen
      ? { model }
      : persistChange({ model, change: (current) => evo(current, { guidanceOpen: () => open }) }),
  ClickedCopyFindingContext: ({ findingId }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById({ state: model.screen.state, findingId });
    return finding === undefined
      ? enqueueToast({ model, message: "The finding is no longer available.", tone: "danger" })
      : {
          model,
          commands: [
            CopyText({ content: findingContext({ finding, model }), successMessage: "Finding context copied." }),
          ],
        };
  },
  ClickedOpenFinding: ({ findingId }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById({ state: model.screen.state, findingId });
    const application = model.screen.state.applications.find(({ id }) => id === model.preferredApplication);
    return finding?.editor !== null && application !== undefined
      ? { model, commands: [OpenEditor({ findingId, application: application.id })] }
      : enqueueToast({
          model,
          message: "Choose an available application before opening this finding.",
          tone: "neutral",
        });
  },
  SelectedEditorApplication: ({ findingId, application }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById({ state: model.screen.state, findingId });
    const available = model.screen.state.applications.some(({ id }) => id === application);
    if (finding?.editor === null || !available) {
      return enqueueToast({ model, message: "That application is not available for this review.", tone: "danger" });
    }
    return appendCommands({
      result: persistChange({ model, change: (current) => evo(current, { preferredApplication: () => application }) }),
      commands: [OpenEditor({ findingId, application })],
    });
  },
});
