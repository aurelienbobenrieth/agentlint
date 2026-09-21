import { currentCalibrationReport } from "../calibration/selectors";
import type { ReviewFindingPayload, ReviewStatePayload } from "@aurelienbbn/agentlint/contract";
import type { Model } from "../../model";
import { draftFor, effectiveFindingStatus } from "../../shared/selectors";

/**
 * Accepting an agent proposal without a note records the proposal itself as the reason.
 */
export const effectiveReason = (model: Model, finding: ReviewFindingPayload): string => {
  const reason = draftFor(model, finding.id).reason.trim();
  if (reason.length > 0) return reason;
  return finding.proposal === null ? "" : `Accepted the agent proposal: ${finding.proposal.summary}`;
};

/**
 * Goes through the effective status: in an attached review a stale local draft must not hand the agent a change request
 * the server no longer holds.
 */
const carriesFeedback = (model: Model, state: ReviewStatePayload, finding: ReviewFindingPayload): boolean => {
  const draft = draftFor(model, finding.id);
  return (
    effectiveFindingStatus(finding, state, model) === "changes_requested" ||
    draft.note.length > 0 ||
    draft.calibration !== "unreviewed"
  );
};

/**
 * The detector's message is labelled as such, never passed off as the reviewer's instruction.
 */
const findingInstruction = (finding: ReviewFindingPayload, model: Model): string => {
  const reason = draftFor(model, finding.id).reason.trim();
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
    const observations = currentCalibrationReport(model.screen.state, model).observations;
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
    .filter((finding) => carriesFeedback(model, state, finding))
    .map((finding) => findingInstruction(finding, model));
  return lines.length === 0
    ? "No review feedback has been recorded yet."
    : ["Apply this agentlint review feedback:", "", ...lines].join("\n");
};

export interface DetachedOutput {
  readonly summary: string;
  readonly feedback: string;
  readonly acceptanceOutput: string;
}

/**
 * What a detached review exports: acceptance JSONL with full identity, plus the agent handoff.
 */
export const detachedOutput = (model: Model, acceptedAt: string): DetachedOutput => {
  if (model.screen._tag !== "Reviewing") {
    return { summary: "Review complete.", feedback: "", acceptanceOutput: "" };
  }
  const state = model.screen.state;
  const hasFeedback =
    state.mode === "calibration"
      ? currentCalibrationReport(state, model).observations.length > 0
      : state.findings.some((finding) => carriesFeedback(model, state, finding));
  const feedback = hasFeedback ? agentInstructions(model) : "";
  const acceptances = state.findings.flatMap((finding) =>
    draftFor(model, finding.id).disposition === "accept" && state.mode === "review"
      ? [
          {
            schemaVersion: 1,
            type: "accept",
            source: finding.identity.source,
            fingerprint: finding.identity.fingerprint,
            ...(finding.identity.lineageKey === null ? {} : { lineageKey: finding.identity.lineageKey }),
            reason: effectiveReason(model, finding),
            authority: "human",
            actor: "local-review",
            acceptedAt,
            reviewedSource: state.sources[finding.file] ?? "",
          },
        ]
      : [],
  );
  const revocations =
    state.mode === "review"
      ? state.findings.flatMap((finding) => {
          const disposition = draftFor(model, finding.id).disposition;
          return finding.acceptance !== null && disposition === "request_changes"
            ? [
                {
                  schemaVersion: 1,
                  type: "revoke",
                  source: finding.identity.source,
                  fingerprint: finding.identity.fingerprint,
                  expectedAcceptedAt: finding.acceptance.at,
                  expectedReason: finding.acceptance.reason,
                  reviewedSource: state.sources[finding.file] ?? "",
                },
              ]
            : [];
        })
      : [];
  const decisions = [...acceptances, ...revocations];
  const acceptanceOutput = decisions.length
    ? `${decisions.map((decision) => JSON.stringify(decision)).join("\n")}\n`
    : "";
  const summary =
    state.mode === "calibration"
      ? "Calibration feedback is ready for the rule author."
      : acceptances.length > 0 && feedback.length > 0
        ? `Prepared ${acceptances.length} acceptance output(s) and an agent handoff.`
        : acceptances.length > 0
          ? `Prepared ${acceptances.length} acceptance output(s).`
          : feedback.length > 0
            ? "Requested changes are ready for the coding agent."
            : "The review closed without exported decisions.";
  return { summary, feedback, acceptanceOutput };
};
