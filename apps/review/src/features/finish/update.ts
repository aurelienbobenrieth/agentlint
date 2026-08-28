import { evo } from "foldkit/struct";

import { type Model, Screen } from "../../model";
import type { Handlers } from "../../shared/update";
import { agentInstructions, detachedOutput } from "../decision/selectors";
import { CopyText } from "../detail/command";
import { enqueueToast } from "../toasts/update";
import { DownloadText, FinishReview, PrepareDetachedFinish } from "./command";
import type { fields } from "./messages";

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  ClickedFinish: () => {
    if (model.screen._tag !== "Reviewing") return { model };
    return {
      model,
      commands: [model.screen.state.transport === "detached" ? PrepareDetachedFinish() : FinishReview()],
    };
  },
  PreparedDetachedFinish: ({ acceptedAt }) => ({
    model: evo(model, { screen: () => Screen.Finished(detachedOutput(model, acceptedAt)), toasts: () => [] }),
  }),
  CompletedFinish: ({ summary, feedback, acceptanceOutput }) => ({
    model: evo(model, { screen: () => Screen.Finished({ summary, feedback, acceptanceOutput }), toasts: () => [] }),
  }),
  FailedFinish: ({ message }) => enqueueToast(model, message, "danger"),
  ClickedCopyInstructions: () => ({ model, commands: [CopyText({ content: agentInstructions(model) })] }),
  ClickedDownloadAcceptances: () => {
    const content = model.screen._tag === "Finished" ? model.screen.acceptanceOutput : "";
    return { model, commands: [DownloadText({ content, filename: "agentlint-acceptances.jsonl" })] };
  },
});
