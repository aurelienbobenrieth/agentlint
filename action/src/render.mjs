// @ts-check
/**
 * Pure rendering of everything the action writes to GitHub: the sticky summary
 * comment, the inline review comment bodies, check-run annotations, and the
 * workflow commands used when the token cannot write.
 */

import { shortDigest, unresolved } from "./artifact.mjs";

/** @typedef {import("./artifact.mjs").Finding} Finding */
/** @typedef {"open" | "closed" | "error"} Gate */

export const SUMMARY_MARKER = "<!-- agentlint:summary -->";
const INLINE_MARKER = /<!-- agentlint:([0-9a-f]{7,64}) -->/;

/** @param {string} digest */
export function inlineMarker(digest) {
  return `<!-- agentlint:${digest} -->`;
}

/**
 * @param {string} body
 * @returns {string | null}
 */
export function digestFromBody(body) {
  return INLINE_MARKER.exec(body)?.[1] ?? null;
}

/**
 * @param {ReadonlyArray<Finding>} findings
 * @returns {{ unresolved: number, human: number, agent: number, accepted: number }}
 */
export function countFindings(findings) {
  const open = unresolved(findings);
  const human = open.filter((finding) => finding.authority === "human").length;
  return {
    unresolved: open.length,
    human,
    agent: open.length - human,
    accepted: findings.filter((finding) => finding.status === "accepted").length,
  };
}

/** @param {Finding} finding */
function acceptCommand(finding) {
  const verb = finding.authority === "human" ? "/agentlint approve" : "agentlint accept";
  return `${verb} ${shortDigest(finding)} --reason "..."`;
}

/** @param {Finding} finding */
function authorityBadge(finding) {
  return finding.authority === "human" ? "**needs human approval**" : "agent authority";
}

/** @param {string} text */
function cell(text) {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * @param {object} input
 * @param {string} input.repository
 * @param {string} input.headSha
 * @param {number} input.pullNumber
 * @param {Gate} input.gate
 * @param {ReadonlyArray<Finding>} input.findings
 * @param {ReadonlySet<string>} input.inlineDigests digests that received an inline comment
 * @param {string} [input.serverUrl]
 */
export function renderSummary(input) {
  const server = input.serverUrl ?? "https://github.com";
  const counts = countFindings(input.findings);
  const open = unresolved(input.findings);
  const lines = [SUMMARY_MARKER, `## agentlint: gate ${gateLabel(input.gate)}`, ""];
  lines.push(
    `${counts.unresolved} unresolved (${counts.human} human, ${counts.agent} agent), ${counts.accepted} accepted. Head \`${input.headSha.slice(0, 7)}\`.`,
    "",
  );
  if (open.length > 0) {
    lines.push("| Rule | Location | Authority | Message | Record the decision |", "| --- | --- | --- | --- | --- |");
    for (const finding of open) {
      const url = `${server}/${input.repository}/blob/${input.headSha}/${finding.file}#L${finding.line}`;
      const location = `[${finding.file}:${finding.line}](${url})`;
      lines.push(
        `| ${cell(finding.ruleTitle)} | ${location} | ${finding.authority} | ${cell(finding.message)} | \`${acceptCommand(finding)}\` |`,
      );
    }
    lines.push("");
  }
  const outside = open.filter((finding) => !input.inlineDigests.has(finding.digest));
  if (outside.length > 0) {
    lines.push("Not inside this pull request's diff, so only listed here:", "");
    for (const finding of outside) {
      lines.push(`- \`${finding.file}:${finding.line}\` ${cell(finding.ruleTitle)} (${finding.authority})`);
    }
    lines.push("");
  }
  lines.push(
    'Human findings: comment `/agentlint approve <digest> --reason "..."` here, or reply `/agentlint approve <reason>` on the inline comment. ' +
      'Agent findings: run `agentlint accept <digest> --reason "..."` locally and push. ' +
      `Review everything locally with \`agentlint pr ${input.pullNumber}\`.`,
  );
  return lines.join("\n");
}

/** @param {Gate} gate */
export function gateLabel(gate) {
  return gate === "open" ? "open" : gate === "closed" ? "closed" : "error";
}

/**
 * @param {Finding} finding
 * @returns {string}
 */
export function renderInlineBody(finding) {
  const lines = [
    inlineMarker(finding.digest),
    `### ${finding.ruleTitle}`,
    "",
    authorityBadge(finding),
    "",
    finding.message,
    "",
  ];
  lines.push("**Standard**", "", finding.guidance.standard, "");
  if (finding.guidance.checks.length > 0) {
    for (const check of finding.guidance.checks) lines.push(`- ${check}`);
    lines.push("");
  }
  if (finding.proposal) {
    lines.push("**Agent proposal**", "", finding.proposal.summary, "");
    if (finding.proposal.diff) {
      lines.push(
        "<details><summary>Proposed diff</summary>",
        "",
        "```diff",
        finding.proposal.diff.trimEnd(),
        "```",
        "",
        "</details>",
        "",
      );
    }
  }
  if (finding.lineageReason) {
    lines.push(`**Prior judgment (context only):** ${finding.lineageReason}`, "");
  }
  if (finding.authority === "human") {
    lines.push('Reply "/agentlint approve <reason>" to accept.');
  } else {
    lines.push(`Run \`agentlint accept ${shortDigest(finding)} --reason "..."\` locally and push to accept.`);
  }
  return lines.join("\n");
}

/**
 * @typedef {object} Annotation
 * @property {string} path
 * @property {number} start_line
 * @property {number} end_line
 * @property {"warning" | "failure"} annotation_level
 * @property {string} message
 * @property {string} title
 */

/**
 * @param {ReadonlyArray<Finding>} findings
 * @returns {Annotation[]}
 */
export function renderAnnotations(findings) {
  return unresolved(findings).map((finding) => ({
    path: finding.file,
    start_line: finding.line,
    end_line: finding.line,
    annotation_level: finding.authority === "human" ? "failure" : "warning",
    message: `${finding.message}\n\n${finding.guidance.standard}\n\nRecord the decision: ${acceptCommand(finding)}`,
    title: `${finding.ruleTitle} (${finding.ruleId})`,
  }));
}

/**
 * @param {Gate} gate
 * @param {ReadonlyArray<Finding>} findings
 * @returns {{ title: string, summary: string }}
 */
export function renderCheckOutput(gate, findings) {
  const counts = countFindings(findings);
  if (gate === "error") {
    return {
      title: "agentlint could not run",
      summary: "The command, configuration, or evidence is invalid. See the job log.",
    };
  }
  if (gate === "open") {
    return {
      title: "Gate open",
      summary: `Every current finding has a compatible acceptance (${counts.accepted} accepted).`,
    };
  }
  return {
    title: `Gate closed: ${counts.unresolved} unresolved`,
    summary: `${counts.human} need human approval, ${counts.agent} need agent acceptance. ${counts.accepted} accepted.`,
  };
}

/** @param {string} value */
function escapeData(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** @param {string} value */
function escapeProperty(value) {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

/**
 * Workflow commands for runs whose token cannot write (fork pull requests).
 *
 * @param {ReadonlyArray<Finding>} findings
 * @returns {string[]}
 */
export function renderWorkflowCommands(findings) {
  return unresolved(findings).map(
    (finding) =>
      `::${finding.authority === "human" ? "error" : "warning"} file=${escapeProperty(finding.file)},line=${finding.line},col=${finding.column},title=${escapeProperty(finding.ruleTitle)}::${escapeData(finding.message)}`,
  );
}

/**
 * @param {number} count
 */
export function renderReviewBody(count) {
  return `agentlint found ${count} ${count === 1 ? "place" : "places"} that need judgment.`;
}
