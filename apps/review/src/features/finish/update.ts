import { calibrationOutput } from "../calibration/selectors";
import { evo } from "foldkit/struct";

import { type ExportKind, type Model, Screen } from "../../model";
import { appendCommands, type Handlers, type UpdateReturn } from "../../shared/update";
import { agentInstructions, detachedOutput } from "../decision/selectors";
import { CopyText } from "../detail/command";
import { MarkDirty } from "../session/command";
import { FocusElement } from "../shortcuts/command";
import { enqueueToast } from "../toasts/update";
import { DownloadText, FinishReview, PrepareDetachedFinish } from "./command";
import type { fields } from "./messages";

type Finished = Extract<Model["screen"], { readonly _tag: "Finished" }>;

/**
 * The finished screen replaces the whole page, so focus moves to its heading and is announced.
 */
const finished = ({
  model,
  screen,
  pendingExports,
}: {
  readonly model: Model;
  readonly screen: Finished;
  readonly pendingExports: ReadonlyArray<ExportKind>;
}): UpdateReturn => ({
  model: evo(model, {
    screen: () => screen,
    toasts: () => [],
    finishing: () => false,
    pendingExports: () => pendingExports,
  }),
  commands: [FocusElement({ selector: ".finish h1" })],
});

/**
 * Only the finished screen tracks what was exported; the same buttons in a running review are plain copies.
 */
const exportKind = ({
  model,
  kind,
}: {
  readonly model: Model;
  readonly kind: ExportKind;
}): { readonly kind?: ExportKind } => (model.screen._tag === "Finished" ? { kind } : {});

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  ClickedFinish: () => {
    if (model.screen._tag !== "Reviewing" || model.busyFindingId !== null || model.finishing) return { model };
    return {
      model: evo(model, { finishing: () => true }),
      commands: [model.screen.state.transport === "detached" ? PrepareDetachedFinish() : FinishReview()],
    };
  },
  // The leave prompt stays armed until every prepared output was downloaded or copied.
  PreparedDetachedFinish: ({ acceptedAt }) => {
    const output = { ...detachedOutput({ model, acceptedAt }), calibrationOutput: calibrationOutput(model) };
    const pending: ReadonlyArray<ExportKind> = [
      ...(output.feedback.length > 0 ? (["feedback"] as const) : []),
      ...(output.acceptanceOutput.length > 0 ? (["acceptances"] as const) : []),
      ...(output.calibrationOutput.length > 0 ? (["calibration"] as const) : []),
    ];
    return appendCommands({
      result: finished({ model, screen: Screen.Finished(output), pendingExports: pending }),
      commands: [MarkDirty({ dirty: pending.length > 0 })],
    });
  },
  CompletedFinish: ({ summary, feedback, acceptanceOutput }) =>
    finished({
      model,
      screen: Screen.Finished({ summary, feedback, acceptanceOutput, calibrationOutput: calibrationOutput(model) }),
      pendingExports: [],
    }),
  FailedFinish: ({ message }) =>
    enqueueToast({ model: evo(model, { finishing: () => false }), message, tone: "danger" }),
  ClickedCopyInstructions: () => ({
    model,
    commands: [CopyText({ content: agentInstructions(model), ...exportKind({ model, kind: "feedback" }) })],
  }),
  ClickedDownloadCalibration: () => {
    const content = model.screen._tag === "Finished" ? model.screen.calibrationOutput : calibrationOutput(model);
    return {
      model,
      commands: content
        ? [
            DownloadText({
              content,
              filename: "agentlint-calibration.json",
              ...exportKind({ model, kind: "calibration" }),
            }),
          ]
        : [],
    };
  },
  ClickedDownloadAcceptances: () => {
    const content = model.screen._tag === "Finished" ? model.screen.acceptanceOutput : "";
    return {
      model,
      commands: [
        DownloadText({
          content,
          filename: "agentlint-acceptances.jsonl",
          ...exportKind({ model, kind: "acceptances" }),
        }),
      ],
    };
  },
  ExportedOutput: ({ kind, message }) => {
    const pending = model.pendingExports.filter((candidate) => candidate !== kind);
    const settled = pending.length === 0 && model.pendingExports.length > 0 ? [MarkDirty({ dirty: false })] : [];
    return appendCommands({
      result: enqueueToast({ model: evo(model, { pendingExports: () => pending }), message, tone: "success" }),
      commands: settled,
    });
  },
});
