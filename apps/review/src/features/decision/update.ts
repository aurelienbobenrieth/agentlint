import { evo } from "foldkit/struct";

import type { ReviewActionRequest, ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import { type Draft, type Model, Screen } from "../../model";
import { draftFor, findingById } from "../../shared/selectors";
import { appendCommands, type Handlers, type UpdateReturn } from "../../shared/update";
import { persist, persistLater } from "../session/update";
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
  kind === "accept"
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
  const request = requestFor(model, kind, findingId, finding);
  const decided = updateDraft(model, findingId, (draft) => ({
    ...draft,
    disposition: dispositionFor(kind, draft.disposition),
  }));
  if (model.screen.state.transport === "detached") {
    const notified = enqueueToast(
      decided,
      kind === "withdraw" ? "Decision withdrawn." : "Decision saved in this browser.",
      "success",
    );
    return appendCommands(persist(notified.model), notified.commands ?? []);
  }
  return appendCommands(persist(evo(model, { busyFindingId: () => findingId })), [SubmitAction({ request })]);
};

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  UpdatedReason: ({ findingId, value }) => editDraft(model, findingId, (draft) => ({ ...draft, reason: value })),
  UpdatedNote: ({ findingId, value }) => editDraft(model, findingId, (draft) => ({ ...draft, note: value })),
  SelectedCalibration: ({ findingId, calibration }) =>
    persist(updateDraft(model, findingId, (draft) => ({ ...draft, calibration }))),
  ClickedAccept: ({ findingId }) => submit(model, "accept", findingId),
  ClickedRequestChanges: ({ findingId }) => submit(model, "request_changes", findingId),
  ClickedWithdraw: ({ findingId }) => submit(model, "withdraw", findingId),
  ClickedSaveCalibration: ({ findingId }) => submit(model, "calibrate", findingId),
  CompletedAction: ({ findingId, state, message }) =>
    enqueueToast(
      evo(
        updateDraft(model, findingId, (draft) => {
          const status = findingById(state, findingId)?.status;
          return {
            ...draft,
            disposition: status === "accepted" ? "accept" : status === "changes_requested" ? "request_changes" : "none",
          };
        }),
        { screen: () => Screen.Reviewing({ state }), busyFindingId: () => null },
      ),
      message,
      "success",
    ),
  FailedAction: ({ message }) => enqueueToast(evo(model, { busyFindingId: () => null }), message, "danger"),
});
