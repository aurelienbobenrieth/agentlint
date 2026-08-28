import { evo } from "foldkit/struct";

import type { Model } from "../../model";
import { findingById } from "../../shared/selectors";
import { appendCommands, type Handlers } from "../../shared/update";
import { persistChange } from "../session/update";
import { enqueueToast } from "../toasts/update";
import { CopyText, OpenEditor } from "./command";
import type { fields } from "./messages";
import { findingContext } from "./selectors";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  SelectedCodeView: ({ codeView }) => persistChange(model, (current) => evo(current, { codeView: () => codeView })),
  ToggledGuidance: () => persistChange(model, (current) => evo(current, { guidanceOpen: (open) => !open })),
  SetGuidanceOpen: ({ open }) =>
    open === model.guidanceOpen
      ? { model }
      : persistChange(model, (current) => evo(current, { guidanceOpen: () => open })),
  ClickedCopyFindingContext: ({ findingId }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById(model.screen.state, findingId);
    return finding === undefined
      ? enqueueToast(model, "The finding is no longer available.", "danger")
      : {
          model,
          commands: [CopyText({ content: findingContext(finding, model), successMessage: "Finding context copied." })],
        };
  },
  ClickedOpenFinding: ({ findingId }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById(model.screen.state, findingId);
    const application = model.screen.state.applications.find(({ id }) => id === model.preferredApplication);
    return finding?.editor !== null && application !== undefined
      ? { model, commands: [OpenEditor({ findingId, application: application.id })] }
      : enqueueToast(model, "Choose an available application before opening this finding.", "neutral");
  },
  SelectedEditorApplication: ({ findingId, application }) => {
    if (model.screen._tag !== "Reviewing") return { model };
    const finding = findingById(model.screen.state, findingId);
    const available = model.screen.state.applications.some(({ id }) => id === application);
    if (finding?.editor === null || !available) {
      return enqueueToast(model, "That application is not available for this review.", "danger");
    }
    return appendCommands(
      persistChange(model, (current) => evo(current, { preferredApplication: () => application })),
      [OpenEditor({ findingId, application })],
    );
  },
});
