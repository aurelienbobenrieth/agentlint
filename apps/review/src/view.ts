import type { Document, Html, HtmlBuilder } from "foldkit/html";

import { finishedView } from "./features/finish/view";
import { loadFailedView, loadingView } from "./features/session/view";
import { reviewView } from "./features/shell/view";
import type { Message } from "./message";
import { type Model, Screen } from "./model";

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "agentlint · Review",
  body: Screen.match<Html>(model.screen, {
    Loading: () => loadingView(h),
    LoadFailed: ({ message }) => loadFailedView(message, h),
    Reviewing: ({ state }) => reviewView(state, model, h),
    Finished: ({ summary, feedback, acceptanceOutput }) => finishedView(summary, feedback, acceptanceOutput, h),
  }),
});
