import { independentHidden } from "../detail/selectors";
import { evo } from "foldkit/struct";

import type { ReviewActionRequest, ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import { type Draft, type Model, Screen } from "../../model";
import { draftFor, duplicateFindingId, findingById } from "../../shared/selectors";
import { appendCommands, type Handlers, type UpdateReturn } from "../../shared/update";
import { reconcileSelection } from "../list/selection";
import { persist, persistLater, rejectDuplicateIds } from "../session/update";
import { enqueueToast } from "../toasts/update";
import { SubmitAction } from "./command";
import type { fields } from "./messages";
import { effectiveReason } from "./selectors";

export type DecisionKind = ReviewActionRequest["type"];

const updateDraft = (model: Model, findingId: string, change: (draft: Draft) => Draft): Model =>
  evo(model, {
    drafts: (drafts) => ({ ...drafts, [findingId]: change(draftFor(model, findingId)) }),
  });

/** Text edits change the model now and persist after a pause. */
const editDraft = (model: Model, findingId: string, change: (draft: Draft) => Draft): UpdateReturn =>
  persistLater(updateDraft(model, findingId, change));

const requestFor = (
  model: Model,
  kind: DecisionKind,
  findingId: string,
  finding: ReviewFindingPayload | undefined,
): ReviewActionRequest => {
  const draft = draftFor(model, findingId);
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
        reason: finding === undefined ? draft.reason : effectiveReason(model, finding),
      };
    case "request_changes":
      return { type: "request_changes", findingId, reason: draft.reason };
  }
};

const dispositionFor = (kind: DecisionKind, current: Draft["disposition"]): Draft["disposition"] =>
  kind === "accept" || kind === "calibrate"
    ? "accept"
    : kind === "request_changes"
      ? "request_changes"
      : kind === "withdraw"
        ? "none"
        : current;

/** Detached decisions live in the draft. Attached decisions enter the draft only after server confirmation. */
export const submit = (model: Model, kind: DecisionKind, findingId: string): UpdateReturn => {
  if (model.screen._tag !== "Reviewing" || model.busyFindingId !== null) return { model };
  const finding = findingById(model.screen.state, findingId);
  if (!finding || (model.screen.state.mode === "review" && independentHidden(model, findingId))) return { model };
  const request = requestFor(model, kind, findingId, finding);
  if (
    request.type === "calibrate" &&
    (draftFor(model, findingId).calibration === "unreviewed" ||
      (request.calibration === "does_not_apply" && request.reason === null))
  )
    return { model };
  const decided = updateDraft(model, findingId, (draft) => ({
    ...draft,
    disposition: dispositionFor(kind, draft.disposition),
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
  }));
  if (model.screen.state.transport === "detached") {
    const moved = reconcileSelection(model, decided);
    const notified = enqueueToast(
      moved.model,
      kind === "withdraw" ? "Decision withdrawn." : "Decision saved in this browser.",
      "success",
    );
    return appendCommands(persist(notified.model), [...(moved.commands ?? []), ...(notified.commands ?? [])]);
  }
  return appendCommands(persist(evo(model, { busyFindingId: () => findingId })), [SubmitAction({ request })]);
};

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  UpdatedReason: ({ findingId, value }) => editDraft(model, findingId, (draft) => ({ ...draft, reason: value })),
  SelectedCalibrationReason: ({ findingId, reason }) =>
    persist(updateDraft(model, findingId, (draft) => ({ ...draft, calibrationReason: reason }))),
  UpdatedNote: ({ findingId, value }) => editDraft(model, findingId, (draft) => ({ ...draft, note: value })),
  SelectedCalibration: ({ findingId, calibration }) =>
    persist(updateDraft(model, findingId, (draft) => ({ ...draft, calibration }))),
  ClickedAccept: ({ findingId }) => submit(model, "accept", findingId),
  ClickedRequestChanges: ({ findingId }) => submit(model, "request_changes", findingId),
  ClickedWithdraw: ({ findingId }) => submit(model, "withdraw", findingId),
  ClickedSaveCalibration: ({ findingId }) => submit(model, "calibrate", findingId),
  CompletedAction: ({ findingId, state, message }) => {
    const duplicate = duplicateFindingId(state);
    if (duplicate !== null) return rejectDuplicateIds(model, duplicate);
    const confirmed = evo(
      updateDraft(model, findingId, (draft) => {
        const status = findingById(state, findingId)?.status;
        return {
          ...draft,
          disposition: status === "accepted" ? "accept" : status === "changes_requested" ? "request_changes" : "none",
        };
      }),
      { screen: () => Screen.Reviewing({ state }), busyFindingId: () => null, refreshFailed: () => false },
    );
    const moved = reconcileSelection(model, confirmed);
    return appendCommands(enqueueToast(moved.model, message, "success"), moved.commands ?? []);
  },
  // The decision is on disk. Only the screen is behind, so this is not an error toast; the top bar
  // offers the reload.
  RecordedActionRefreshFailed: () =>
    enqueueToast(
      evo(model, { busyFindingId: () => null, refreshFailed: () => true }),
      "Decision saved; reload to refresh.",
      "neutral",
    ),
  FailedAction: ({ message }) => enqueueToast(evo(model, { busyFindingId: () => null }), message, "danger"),
});
