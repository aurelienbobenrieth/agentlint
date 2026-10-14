import { independentHidden } from "../detail/selectors";
import { modifyFields } from "foldkit/struct";

import type { ReviewActionRequest, ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import { type Draft, type Model, Screen } from "../../shared/model";
import { deriveReview, draftFor, duplicateFindingId, findingById } from "../../shared/selectors";
import { appendCommands, type Handlers, type UpdateReturn } from "../../shared/update";
import { reconcileSelection, selectFinding } from "../list/selection";
import { RevealFinding, SettleSelection } from "../list/command";
import { persist, persistLater, rejectDuplicateIds } from "../session/update";
import { MarkDirty } from "../session/command";
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
  modifyFields(model, {
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

const keepDecision = ({
  before,
  model,
  findingId,
}: {
  readonly before: Model;
  readonly model: Model;
  readonly findingId: string;
}): Model => {
  if (model.screen._tag !== "Reviewing" || model.screen.state.mode !== "review") return model;
  if (
    before.screen._tag !== "Reviewing" ||
    (!before.retainedFindingIds.includes(findingId) &&
      !deriveReview({ state: before.screen.state, model: before }).visible.some(({ id }) => id === findingId))
  )
    return model;
  const findings = model.screen.state.findings;
  if (
    findings.find(({ id }) => id === findingId)?.file !==
    findings.find(({ id }) => id === model.selectedFindingId)?.file
  )
    return model;
  return modifyFields(model, {
    retainedFindingIds: (ids) => [...new Set([...ids, findingId])],
    editingDecisionIds: (ids) => ids.filter((id) => id !== findingId),
  });
};

const advanceAcceptance = ({
  before,
  after,
  findingId,
}: {
  readonly before: Model;
  readonly after: Model;
  readonly findingId: string;
}): UpdateReturn => {
  if (before.screen._tag !== "Reviewing" || after.screen._tag !== "Reviewing" || after.view !== "queue")
    return reconcileSelection({ before, after });
  const previous = deriveReview({ state: before.screen.state, model: before }).visible;
  const current = deriveReview({ state: after.screen.state, model: after });
  const unresolved = new Set(
    current.visible.filter(({ id }) => current.statusOf.get(id) === "unresolved").map(({ id }) => id),
  );
  const index = previous.findIndex(({ id }) => id === findingId);
  const next =
    previous.slice(index + 1).find(({ id }) => unresolved.has(id)) ??
    previous.slice(0, Math.max(0, index)).find(({ id }) => unresolved.has(id));
  if (next === undefined) return reconcileSelection({ before, after });
  const selected = modifyFields(selectFinding({ model: after, findingId: next.id }), { selectionSettled: () => false });
  return {
    model: selected,
    commands: [RevealFinding({ findingId: next.id }), SettleSelection({ version: selected.selectionVersion })],
  };
};

/**
 * Attached acceptances leave the queue immediately, while their immutable requests await server confirmation.
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
  if (model.screen._tag !== "Reviewing" || model.finishing) return { model };
  if (model.pendingAcceptances.some((pending) => pending.findingId === findingId)) return { model };
  if (model.busyFindingId !== null && (kind !== "accept" || model.pendingAcceptances.length === 0)) return { model };
  const finding = findingById({ state: model.screen.state, findingId });
  if (!finding || (model.screen.state.mode === "review" && independentHidden({ model, findingId }))) return { model };
  const request = requestFor({ model, kind, findingId, finding });
  if (request.type === "accept" && request.reason.trim().length === 0) return { model };
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
    const kept = keepDecision({ before: model, model: decided, findingId });
    const moved =
      kind === "accept"
        ? advanceAcceptance({ before: model, after: kept, findingId })
        : reconcileSelection({ before: model, after: kept });
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
  if (request.type === "accept") {
    const pending = modifyFields(model, {
      pendingAcceptances: (acceptances) => [...acceptances, { findingId, reason: request.reason }],
      busyFindingId: (busy) => busy ?? findingId,
    });
    const moved = advanceAcceptance({
      before: model,
      after: keepDecision({ before: model, model: pending, findingId }),
      findingId,
    });
    return appendCommands({
      result: persist(moved.model),
      commands: [...(moved.commands ?? []), ...(model.busyFindingId === null ? [SubmitAction({ request })] : [])],
    });
  }
  return appendCommands({
    result: persist(modifyFields(model, { busyFindingId: () => findingId })),
    commands: [SubmitAction({ request })],
  });
};

/**
 * Serialize writes and refetches so an older response cannot replace a newer decision.
 */
const settleAcceptance = ({
  model,
  findingId,
}: {
  readonly model: Model;
  readonly findingId: string;
}): UpdateReturn => {
  const remaining = model.pendingAcceptances.filter((pending) => pending.findingId !== findingId);
  const next = remaining[0];
  return {
    model: modifyFields(model, { pendingAcceptances: () => remaining, busyFindingId: () => next?.findingId ?? null }),
    commands: [
      MarkDirty({ dirty: remaining.length > 0 }),
      ...(next === undefined ? [] : [SubmitAction({ request: { type: "accept", ...next } })]),
    ],
  };
};

/**
 * A detached acceptance exports the reason as it stands at finish, so clearing it withdraws the acceptance instead of
 * leaving one the import would reject.
 */
const editReason = ({
  model,
  findingId,
  value,
}: {
  readonly model: Model;
  readonly findingId: string;
  readonly value: string;
}): UpdateReturn => {
  const edited = updateDraft({ model, findingId, change: (draft) => ({ ...draft, reason: value }) });
  if (
    model.screen._tag !== "Reviewing" ||
    model.screen.state.transport !== "detached" ||
    model.screen.state.mode !== "review" ||
    draftFor({ model, findingId }).disposition !== "accept"
  )
    return persistLater(edited);
  const finding = findingById({ state: model.screen.state, findingId });
  if (finding === undefined || effectiveReason({ model: edited, finding }).length > 0) return persistLater(edited);
  const notified = enqueueToast({
    model: updateDraft({ model: edited, findingId, change: (draft) => ({ ...draft, disposition: "none" }) }),
    message: "Acceptance withdrawn: accepting needs a reason.",
    tone: "neutral",
  });
  return appendCommands({ result: persist(notified.model), commands: notified.commands ?? [] });
};

export const cases = (model: Model): Handlers<keyof typeof fields> => ({
  UpdatedReason: ({ findingId, value }) => editReason({ model, findingId, value }),
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
    const confirmed = modifyFields(
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
    const settled = settleAcceptance({ model: confirmed, findingId });
    const moved = reconcileSelection({
      before: model,
      after: keepDecision({ before: model, model: settled.model, findingId }),
    });
    return appendCommands({
      result: enqueueToast({ model: moved.model, message, tone: "success" }),
      commands: [...(settled.commands ?? []), ...(moved.commands ?? [])],
    });
  },
  // The decision is on disk. Only the screen is behind, so this is not an error toast; the top bar
  // offers the reload.
  RecordedActionRefreshFailed: ({ findingId }) => {
    const settled = settleAcceptance({ model, findingId });
    const moved = reconcileSelection({ before: model, after: settled.model });
    return appendCommands({
      result: enqueueToast({
        model: modifyFields(moved.model, { refreshFailed: () => true }),
        message: "Decision saved; reload to refresh.",
        tone: "neutral",
      }),
      commands: [...(settled.commands ?? []), ...(moved.commands ?? [])],
    });
  },
  FailedAction: ({ findingId, message }) => {
    const settled = settleAcceptance({ model, findingId });
    const moved = reconcileSelection({ before: model, after: settled.model });
    return appendCommands({
      result: enqueueToast({ model: moved.model, message, tone: "danger" }),
      commands: [...(settled.commands ?? []), ...(moved.commands ?? [])],
    });
  },
});
