import type { ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import type { Model } from "../../model";
import { draftFor } from "../../shared/selectors";

/** Accepting an agent proposal without a note records the proposal itself as the reason. */
export const effectiveReason = (model: Model, finding: ReviewFindingPayload): string => {
  const reason = draftFor(model, finding.id).reason.trim();
  if (reason.length > 0) return reason;
  return finding.proposal === null ? "" : `Accepted the agent proposal: ${finding.proposal.summary}`;
};

const carriesFeedback = (model: Model, finding: ReviewFindingPayload): boolean => {
  const draft = draftFor(model, finding.id);
  if (model.screen._tag === "Reviewing" && model.screen.state.mode === "calibration")
    return draft.disposition === "accept";
  return draft.disposition === "request_changes" || draft.note.length > 0 || draft.calibration !== "unreviewed";
};

const findingInstruction = (finding: ReviewFindingPayload, model: Model): string => {
  const draft = draftFor(model, finding.id);
  if (model.screen._tag === "Reviewing" && model.screen.state.mode === "calibration") {
    return `- ${finding.ruleId} at ${finding.file}:${finding.line}: ${draft.calibration}. ${draft.note}`;
  }
  return `- ${finding.ruleId} at ${finding.file}:${finding.line}: ${draft.reason || finding.message}`;
};

/** The handoff a coding agent applies: every change request, note, and calibration label. */
export const agentInstructions = (model: Model): string => {
  if (model.screen._tag === "Finished") {
    return model.screen.feedback.length > 0 ? model.screen.feedback : "No changes were requested.";
  }
  if (model.screen._tag !== "Reviewing") return "No open review instructions.";
  const lines = model.screen.state.findings
    .filter((finding) => carriesFeedback(model, finding))
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

/** What a detached review exports: acceptance JSONL with full identity, plus the agent handoff. */
export const detachedOutput = (model: Model, acceptedAt: string): DetachedOutput => {
  if (model.screen._tag !== "Reviewing") {
    return { summary: "Review complete.", feedback: "", acceptanceOutput: "" };
  }
  const state = model.screen.state;
  const feedback = state.findings.some((finding) => carriesFeedback(model, finding)) ? agentInstructions(model) : "";
  const acceptances = state.findings.flatMap((finding) =>
    draftFor(model, finding.id).disposition === "accept" && state.mode === "review"
      ? [
          {
            schemaVersion: 1,
            source: finding.identity.source,
            fingerprint: finding.identity.fingerprint,
            ...(finding.identity.lineageKey === null ? {} : { lineageKey: finding.identity.lineageKey }),
            reason: effectiveReason(model, finding),
            authority: "human",
            actor: "local-review",
            acceptedAt,
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
