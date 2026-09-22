import { independentHidden } from "../detail/selectors";
import { evo } from "foldkit/struct";

import type { ReviewActionRequest, ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import { type Draft, type Model, Screen } from "../../shared/model";
import { draftFor, duplicateFindingId, findingById } from "../../shared/selectors";
import { appendCommands, type Handlers, type UpdateReturn } from "../../shared/update";
import { reconcileSelection } from "../list/selection";
import { persist, persistLater, rejectDuplicateIds } from "../session/update";
import { enqueueToast } from "../toasts/update";
import { SubmitAction } from "./command";
import type { fields } from "./messages";
import { effectiveReason } from "./selectors";

export type DecisionKind = ReviewActionRequest["type"];

const updateDraft = ({
  model,
  findingId,
  change,
}: {
  readonly model: Model;
  readonly findingId: string;
  readonly change: (draft: Draft) => Draft;
}): Model =>
  evo(model, {
    drafts: (drafts) => ({ ...drafts, [findingId]: change(draftFor({ model, findingId })) }),
  });

/**
 * Text edits change the model now and persist after a pause.
 */
const editDraft = ({
  model,
  findingId,
  change,
}: {
  readonly model: Model;
  readonly findingId: string;
  readonly change: (draft: Draft) => Draft;
}): UpdateReturn => persistLater(updateDraft({ model, findingId, change }));

const requestFor = ({
  model,
  kind,
  findingId,
  finding,
}: {
  readonly model: Model;
  readonly kind: DecisionKind;
  readonly findingId: string;
  readonly finding: ReviewFindingPayload | undefined;
}): ReviewActionRequest => {
  const draft = draftFor({ model, findingId });
  switch (kind) {
    case "withdraw":
      return { type: "withdraw", findingId };
    case "calibrate":
      return {
        type: "calibrate",
        findingId,
        calibration: draft.calibration === "unreviewed" ? "unsure" : draft.calibration,
        note: draft.note,
        reason: draft.calibration === "does_not_apply" ? draft.calibrationReason : null,
      };
    case "accept":
      return {
        type: "accept",
        findingId,
        reason: finding === undefined ? draft.reason : effectiveReason({ model, finding }),
      };
    case "request_changes":
      return { type: "request_changes", findingId, reason: draft.reason };
  }
  return kind satisfies never;
};

const dispositions: Record<DecisionKind, Draft["disposition"]> = {
  accept: "accept",
  calibrate: "accept",
  request_changes: "request_changes",
  withdraw: "none",
};

const dispositionFor = (kind: DecisionKind): Draft["disposition"] => dispositions[kind];

/**
 * Detached decisions live in the draft. Attached decisions enter the draft only after server confirmation.
 */
export const submit = ({
  model,
  kind,
  findingId,
}: {
  readonly model: Model;
  readonly kind: DecisionKind;
  readonly findingId: string;
}): UpdateReturn => {
  if (model.screen._tag !== "Reviewing" || model.busyFindingId !== null) return { model };
  const finding = findingById({ state: model.screen.state, findingId });
  if (!finding || (model.screen.state.mode === "review" && independentHidden({ model, findingId }))) return { model };
  const request = requestFor({ model, kind, findingId, finding });
  if (
    request.type === "calibrate" &&
    (draftFor({ model, findingId }).calibration === "unreviewed" ||
      (request.calibration === "does_not_apply" && request.reason === null))
  )
    return { model };
  const decided = updateDraft({
    model,
    findingId,
    change: (draft) => ({
      ...draft,
      disposition: dispositionFor(kind),
      savedCalibration:
        request.type === "calibrate"
          ? {
              findingId: finding.id,
              identity: finding.identity,
              ruleId: finding.ruleId,
              file: finding.file,
              classification: request.calibration,
              reason: request.reason,
              note: request.note,
              invalidationReasons: finding.invalidationReasons,
            }
          : draft.savedCalibration,
    }),
  });
  if (model.screen.state.transport === "detached") {
    const moved = reconcileSelection({ before: model, after: decided });
    const notified = enqueueToast({
      model: moved.model,
      message: kind === "withdraw" ? "Decision withdrawn." : "Decision saved in this browser.",
      tone: "success",
    });
    return appendCommands({
      result: persist(notified.model),
      commands: [...(moved.commands ?? []), ...(notified.commands ?? [])],
    });
  }
  return appendCommands({
    result: persist(evo(model, { busyFindingId: () => findingId })),
    commands: [SubmitAction({ request })],
  });
};

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  UpdatedReason: ({ findingId, value }) =>
    editDraft({ model, findingId, change: (draft) => ({ ...draft, reason: value }) }),
  SelectedCalibrationReason: ({ findingId, reason }) =>
    persist(updateDraft({ model, findingId, change: (draft) => ({ ...draft, calibrationReason: reason }) })),
  UpdatedNote: ({ findingId, value }) =>
    editDraft({ model, findingId, change: (draft) => ({ ...draft, note: value }) }),
  SelectedCalibration: ({ findingId, calibration }) =>
    persist(updateDraft({ model, findingId, change: (draft) => ({ ...draft, calibration }) })),
  ClickedAccept: ({ findingId }) => submit({ model, kind: "accept", findingId }),
  ClickedRequestChanges: ({ findingId }) => submit({ model, kind: "request_changes", findingId }),
  ClickedWithdraw: ({ findingId }) => submit({ model, kind: "withdraw", findingId }),
  ClickedSaveCalibration: ({ findingId }) => submit({ model, kind: "calibrate", findingId }),
  CompletedAction: ({ findingId, state, message }) => {
    const duplicate = duplicateFindingId(state);
    if (duplicate !== null) return rejectDuplicateIds({ model, id: duplicate });
    const confirmed = evo(
      updateDraft({
        model,
        findingId,
        change: (draft) => {
          const status = findingById({ state, findingId })?.status;
          return {
            ...draft,
            disposition: status === "accepted" ? "accept" : status === "changes_requested" ? "request_changes" : "none",
          };
        },
      }),
      { screen: () => Screen.Reviewing({ state }), busyFindingId: () => null, refreshFailed: () => false },
    );
    const moved = reconcileSelection({ before: model, after: confirmed });
    return appendCommands({
      result: enqueueToast({ model: moved.model, message, tone: "success" }),
      commands: moved.commands ?? [],
    });
  },
  // The decision is on disk. Only the screen is behind, so this is not an error toast; the top bar
  // offers the reload.
  RecordedActionRefreshFailed: () =>
    enqueueToast({
      model: evo(model, { busyFindingId: () => null, refreshFailed: () => true }),
      message: "Decision saved; reload to refresh.",
      tone: "neutral",
    }),
  FailedAction: ({ message }) =>
    enqueueToast({ model: evo(model, { busyFindingId: () => null }), message, tone: "danger" }),
});
