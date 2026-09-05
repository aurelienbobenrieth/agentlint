import type { ReviewFindingPayload } from "@aurelienbbn/agentlint/contract";
import type { Model } from "../../model";
import { draftFor } from "../../shared/selectors";

const fenced = (content: string, language = ""): string => {
  const fence = content.includes("```") ? "````" : "```";
  return `${fence}${language}\n${content}\n${fence}`;
};

const focusedSource = (finding: ReviewFindingPayload, source: string): string => {
  const lines = source.split("\n");
  const start = Math.max(0, finding.code.focus.startLine - 4);
  const end = Math.min(lines.length, finding.code.focus.endLine + 3);
  return lines
    .slice(start, end)
    .map((line, index) => `${String(start + index + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
};

/** Complete, paste-ready evidence for discussing one finding with another agent. */
export const findingContext = (finding: ReviewFindingPayload, model: Model): string => {
  const source = model.screen._tag === "Reviewing" ? (model.screen.state.sources[finding.file] ?? "") : "";
  const draft = draftFor(model, finding.id);
  const status =
    draft.disposition === "accept"
      ? "accepted"
      : draft.disposition === "request_changes"
        ? "changes_requested"
        : finding.status;
  const language = finding.file.match(/\.tsx?$/u) ? "typescript" : finding.file.match(/\.jsx?$/u) ? "javascript" : "";
  const reviewInput = [
    draft.disposition !== "none" ? `Disposition: ${draft.disposition}` : null,
    draft.reason.trim().length > 0 ? `Reason or requested change: ${draft.reason.trim()}` : null,
    draft.calibration !== "unreviewed" ? `Calibration: ${draft.calibration}` : null,
    draft.note.trim().length > 0 ? `Calibration note: ${draft.note.trim()}` : null,
  ].filter((line): line is string => line !== null);
  const acceptance =
    finding.acceptance === null
      ? "None."
      : `${finding.acceptance.reason} (by ${finding.acceptance.actor}, ${finding.acceptance.at})`;
  const references =
    finding.guidance.references.length === 0
      ? "None."
      : finding.guidance.references
          .map((reference) => `- ${reference.label} (${reference.kind}): ${reference.target}`)
          .join("\n");
  const examples =
    finding.guidance.examples.length === 0
      ? "None provided."
      : finding.guidance.examples
          .map((example) =>
            [
              example.label === null ? null : `### ${example.label}`,
              example.description,
              fenced(example.code, language),
            ]
              .filter((part): part is string => part !== null)
              .join("\n\n"),
          )
          .join("\n\n");
  const identity = {
    ruleId: finding.ruleId,
    source: finding.identity.source,
    fingerprint: finding.identity.fingerprint,
    lineageKey: finding.identity.lineageKey,
  };

  return [
    `# agentlint finding: ${finding.ruleTitle}`,
    "",
    `- Rule: \`${finding.ruleId}\``,
    `- Location: \`${finding.file}:${finding.line}:${finding.column}\``,
    `- Lifecycle: ${finding.lifecycle}`,
    `- Review authority: ${finding.authority}`,
    `- Status: ${status}`,
    "",
    "## Why this was flagged",
    "",
    finding.message,
    "",
    "## Rule standard",
    "",
    ...(finding.guidance.summary === null ? [] : [finding.guidance.summary, ""]),
    finding.guidance.standard,
    ...(finding.guidance.checks.length > 0
      ? ["", "### Review checklist", "", ...finding.guidance.checks.map((check) => `- ${check}`)]
      : []),
    "",
    "## Focused code context",
    "",
    fenced(focusedSource(finding, source), language),
    "",
    "## Complete file",
    "",
    fenced(source, language),
    "",
    "## Permitted examples",
    "",
    examples,
    "",
    "## References",
    "",
    references,
    "",
    "## Current review evidence",
    "",
    `Acceptance: ${acceptance}`,
    `Prior lineage reasoning: ${finding.lineageReason ?? "None."}`,
    ...(reviewInput.length > 0 ? ["", ...reviewInput] : []),
    "",
    "## Stable identity",
    "",
    fenced(JSON.stringify(identity, null, 2), "json"),
  ].join("\n");
};
