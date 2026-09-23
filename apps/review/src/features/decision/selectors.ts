import { currentCalibrationReport } from "../calibration/selectors";
import {
  DetachedDecision,
  type DetachedAcceptance,
  type DetachedRevocation,
  type ReviewFindingPayload,
  type ReviewStatePayload,
} from "@aurelienbbn/agentlint/contract";
import { Array as A, Result, Schema as S } from "effect";
import type { Model } from "../../shared/model";
import { draftFor, effectiveFindingStatus } from "../../shared/selectors";

/**
 * Accepting an agent proposal without a note records the proposal itself as the reason.
 */
export const effectiveReason = ({
  model,
  finding,
}: {
  readonly model: Model;
  readonly finding: ReviewFindingPayload;
}): string => {
  const reason = draftFor({ model, findingId: finding.id }).reason.trim();
  if (reason.length > 0) return reason;
  return finding.proposal === null ? "" : `Accepted the agent proposal: ${finding.proposal.summary}`;
};

/**
 * Goes through the effective status: in an attached review a stale local draft must not hand the agent a change request
 * the server no longer holds.
 */
const carriesFeedback = ({
  model,
  state,
  finding,
}: {
  readonly model: Model;
  readonly state: ReviewStatePayload;
  readonly finding: ReviewFindingPayload;
}): boolean => {
  const draft = draftFor({ model, findingId: finding.id });
  return (
    effectiveFindingStatus({ finding, state, model }) === "changes_requested" ||
    draft.note.length > 0 ||
    draft.calibration !== "unreviewed"
  );
};

/**
 * The detector's message is labelled as such, never passed off as the reviewer's instruction.
 */
const findingInstruction = ({
  finding,
  model,
}: {
  readonly finding: ReviewFindingPayload;
  readonly model: Model;
}): string => {
  const reason = draftFor({ model, findingId: finding.id }).reason.trim();
  const location = `${finding.ruleId} at ${finding.file}:${finding.line}`;
  return reason.length > 0
    ? `- ${location}: ${reason}`
    : `- ${location}: the reviewer left no instruction. The detector reported: ${finding.message}`;
};

/**
 * The handoff a coding agent applies: every change request, note, and calibration label.
 */
export const agentInstructions = (model: Model): string => {
  if (model.screen._tag === "Finished") {
    return model.screen.feedback.length > 0 ? model.screen.feedback : "No changes were requested.";
  }
  if (model.screen._tag !== "Reviewing") return "No open review instructions.";
  if (model.screen.state.mode === "calibration") {
    const observations = currentCalibrationReport({ state: model.screen.state, model }).observations;
    return observations.length === 0
      ? "No review feedback has been recorded yet."
      : [
          "Refine the rules using these saved calibration labels:",
          "",
          ...observations.map(
            (item) =>
              `- ${item.ruleId} at ${item.file}: ${item.classification}${item.reason ? ` (${item.reason})` : ""}. ${item.note}`,
          ),
        ].join("\n");
  }
  const state = model.screen.state;
  const lines = state.findings
    .filter((finding) => carriesFeedback({ model, state, finding }))
    .map((finding) => findingInstruction({ finding, model }));
  return lines.length === 0
    ? "No review feedback has been recorded yet."
    : ["Apply this agentlint review feedback:", "", ...lines].join("\n");
};

export interface DetachedOutput {
  readonly summary: string;
  readonly feedback: string;
  readonly acceptanceOutput: string;
}

const encodeDecision = S.encodeResult(S.fromJsonString(DetachedDecision));

/**
 * Each line goes through the import schema, so a record `agentlint acceptances import` would reject is never written. A
 * rejected decision is left out and its finding stays unresolved.
 */
const encodeDecisions = (
  decisions: ReadonlyArray<{ readonly findingId: string; readonly decision: DetachedDecision }>,
): { readonly lines: ReadonlyArray<string>; readonly rejected: ReadonlyArray<string> } => {
  const [rejected, lines] = A.partition(decisions, ({ findingId, decision }) =>
    Result.mapError(encodeDecision(decision), () => findingId),
  );
  return { lines, rejected };
};

const acceptanceFor = ({
  model,
  state,
  finding,
  acceptedAt,
}: {
  readonly model: Model;
  readonly state: ReviewStatePayload;
  readonly finding: ReviewFindingPayload;
  readonly acceptedAt: string;
}): DetachedAcceptance => ({
  schemaVersion: 1,
  type: "accept",
  source: finding.identity.source,
  fingerprint: finding.identity.fingerprint,
  ...(finding.identity.lineageKey === null ? {} : { lineageKey: finding.identity.lineageKey }),
  reason: effectiveReason({ model, finding }),
  authority: "human",
  actor: "local-review",
  acceptedAt,
  reviewedSource: state.sources[finding.file] ?? "",
});

const revocationFor = ({
  state,
  finding,
  acceptance,
}: {
  readonly state: ReviewStatePayload;
  readonly finding: ReviewFindingPayload;
  readonly acceptance: NonNullable<ReviewFindingPayload["acceptance"]>;
}): DetachedRevocation => ({
  schemaVersion: 1,
  type: "revoke",
  source: finding.identity.source,
  fingerprint: finding.identity.fingerprint,
  expectedAcceptedAt: acceptance.at,
  expectedReason: acceptance.reason,
  reviewedSource: state.sources[finding.file] ?? "",
});

/**
 * What a detached review exports: acceptance JSONL with full identity, plus the agent handoff.
 */
export const detachedOutput = ({
  model,
  acceptedAt,
}: {
  readonly model: Model;
  readonly acceptedAt: string;
}): DetachedOutput => {
  if (model.screen._tag !== "Reviewing") {
    return { summary: "Review complete.", feedback: "", acceptanceOutput: "" };
  }
  const state = model.screen.state;
  const hasFeedback =
    state.mode === "calibration"
      ? currentCalibrationReport({ state, model }).observations.length > 0
      : state.findings.some((finding) => carriesFeedback({ model, state, finding }));
  const feedback = hasFeedback ? agentInstructions(model) : "";
  const acceptances = encodeDecisions(
    state.mode === "review"
      ? state.findings.flatMap((finding) =>
          draftFor({ model, findingId: finding.id }).disposition === "accept"
            ? [{ findingId: finding.id, decision: acceptanceFor({ model, state, finding, acceptedAt }) }]
            : [],
        )
      : [],
  );
  const revocations = encodeDecisions(
    state.mode === "review"
      ? state.findings.flatMap((finding) =>
          finding.acceptance !== null && draftFor({ model, findingId: finding.id }).disposition === "request_changes"
            ? [{ findingId: finding.id, decision: revocationFor({ state, finding, acceptance: finding.acceptance }) }]
            : [],
        )
      : [],
  );
  const lines = [...acceptances.lines, ...revocations.lines];
  const rejected = [...acceptances.rejected, ...revocations.rejected];
  const acceptanceOutput = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  const accepted = acceptances.lines.length;
  const outcome =
    state.mode === "calibration"
      ? "Calibration feedback is ready for the rule author."
      : accepted > 0 && feedback.length > 0
        ? `Prepared ${accepted} acceptance output(s) and an agent handoff.`
        : accepted > 0
          ? `Prepared ${accepted} acceptance output(s).`
          : feedback.length > 0
            ? "Requested changes are ready for the coding agent."
            : "The review closed without exported decisions.";
  const summary =
    rejected.length > 0
      ? `${outcome} ${rejected.length} decision(s) could not be exported and stay unresolved: ${rejected.join(", ")}.`
      : outcome;
  return { summary, feedback, acceptanceOutput };
};
