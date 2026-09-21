// @ts-check
/**
 * Pure rendering of everything the action writes to GitHub: the sticky summary
 * comment, the inline review comment bodies, check-run annotations, and the
 * workflow commands used when the token cannot write.
 */

import { isRecord, shortDigest, unresolved } from "./artifact.mjs";

/** @typedef {import("./artifact.mjs").Finding} Finding */
/** @typedef {"open" | "closed" | "error"} Gate */

export const SUMMARY_MARKER = "<!-- agentlint:summary -->";
const INLINE_MARKER = /<!-- agentlint:([0-9a-f]{7,64}) -->/;

/** @param {string} digest */
function inlineMarker(digest) {
  return `<!-- agentlint:${digest} -->`;
}

/**
 * @param {string} body
 * @returns {string | null}
 */
export function digestFromBody(body) {
  return INLINE_MARKER.exec(body)?.[1] ?? null;
}

const HEAD_MARKER = /<!-- agentlint:head:([0-9a-f]{40,64}) -->/;
const HEAD_TEXT = /Head `([0-9a-f]{7,64})`/;

/**
 * The head commit a summary comment was rendered for: the full SHA from the hidden marker, or the abbreviated one from
 * the visible text of a summary written by an earlier version.
 *
 * @param {string} body
 * @returns {string | null}
 */
export function headFromSummary(body) {
  return HEAD_MARKER.exec(body)?.[1] ?? HEAD_TEXT.exec(body)?.[1] ?? null;
}

/**
 * Anyone who can comment can write a marker, and so can any other bot. Only a comment posted by the account the
 * action's own token acts as is an agentlint comment. `identity` is that login as GitHub reports it for the token;
 * REST spells an application's account `<slug>[bot]`, so that spelling matches too, for a `Bot` account only.
 *
 * @param {unknown} comment a GitHub issue or review comment
 * @param {string} identity
 */
export function isActionComment(comment, identity) {
  if (!isRecord(comment) || identity === "") return false;
  const user = comment["user"];
  if (!isRecord(user) || typeof user["login"] !== "string") return false;
  return user["login"] === identity || (user["type"] === "Bot" && user["login"] === `${identity}[bot]`);
}

/** GitHub rejects a comment body above 65,536 characters. Everything rendered here stays under this. */
export const BODY_BUDGET = 60_000;
const MORE = "open the review artifact";

/**
 * @param {string} value
 * @param {number} limit
 */
function clip(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit).trimEnd()} … (truncated)`;
}

/**
 * Finding text comes from the pull request: messages, standards, proposals, file names. Rendered as prose it must stay
 * prose: no HTML (`<img>` tracking pixels), no links or images, no table or code-span delimiters, no heading, and no
 * `@mention` that notifies someone (a zero-width space after `@` breaks it).
 *
 * @param {string} value
 */
export function plain(value) {
  const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
  return value
    .replace(/[\\`|[\]]/g, "\\$&")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, `@${ZERO_WIDTH_SPACE}`)
    .replace(/^(\s*)#/gm, "$1\\#");
}

/**
 * A code span whose delimiter is longer than any backtick run inside it. Pipes stay escaped for table cells.
 *
 * @param {string} value
 */
export function codeSpan(value) {
  const flat = value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
  const delimiter = "`".repeat(longest + 1);
  return longest === 0 ? `${delimiter}${flat}${delimiter}` : `${delimiter} ${flat} ${delimiter}`;
}

/**
 * A fenced block whose fence is longer than any backtick run in the content (CommonMark), so the content cannot close
 * it and continue as markdown.
 *
 * @param {string} content
 * @param {string} [language]
 */
export function fenced(content, language = "") {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

const DIFF_LIMIT = 20_000;

/** @param {string} diff */
function clipDiff(diff) {
  const trimmed = diff.trimEnd();
  if (trimmed.length <= DIFF_LIMIT) return trimmed;
  const cut = trimmed.lastIndexOf("\n", DIFF_LIMIT);
  const kept = trimmed.slice(0, cut > 0 ? cut : DIFF_LIMIT);
  const dropped = trimmed.slice(kept.length).split("\n").length - 1;
  return `${kept}\n… diff truncated, ${dropped} more lines: ${MORE}`;
}

/**
 * A reply that quotes CLI or git output.
 *
 * @param {string} heading
 * @param {string} output
 */
export function renderFailureReply(heading, output) {
  return `${heading}\n\n${fenced(clip(output.trim(), 5_000))}`;
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

/**
 * @param {string} text
 * @param {number} limit
 */
function cell(text, limit) {
  return clip(plain(text.replace(/\s*\r?\n\s*/g, " ")), limit);
}

/** @param {string} file */
function urlPath(file) {
  return file
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[()]/g, (char) => (char === "(" ? "%28" : "%29")))
    .join("/");
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
  const lines = [SUMMARY_MARKER];
  // The full head lets a later `path:line` approval prove that it answers this exact scan.
  if (/^[0-9a-f]{40,64}$/.test(input.headSha)) lines.push(`<!-- agentlint:head:${input.headSha} -->`);
  lines.push(
    `## agentlint: gate ${gateLabel(input.gate)}`,
    "",
    `${counts.unresolved} unresolved (${counts.human} human, ${counts.agent} agent), ${counts.accepted} accepted. Head \`${input.headSha.slice(0, 7)}\`.`,
    "",
  );
  // Rows are added while the body stays inside the budget. The rest is counted, never silently dropped.
  let room = BODY_BUDGET - lines.join("\n").length - 1_000;
  /**
   * @template T
   * @param {ReadonlyArray<T>} items
   * @param {(item: T) => string} render
   * @param {string} noun
   */
  const pushWithinBudget = (items, render, noun) => {
    let shown = 0;
    for (const item of items) {
      const line = render(item);
      if (line.length + 1 > room) break;
      room -= line.length + 1;
      lines.push(line);
      shown++;
    }
    if (shown < items.length) lines.push("", `… and ${items.length - shown} more ${noun} — ${MORE}.`);
    lines.push("");
  };
  if (open.length > 0) {
    lines.push("| Rule | Location | Authority | Message | Record the decision |", "| --- | --- | --- | --- | --- |");
    pushWithinBudget(
      open,
      (finding) => {
        const url = `${server}/${input.repository}/blob/${input.headSha}/${urlPath(finding.file)}#L${finding.line}`;
        const location = `[${cell(finding.file, 300)}:${finding.line}](${url})`;
        return `| ${cell(finding.ruleTitle, 200)} | ${location} | ${finding.authority} | ${cell(finding.message, 300)} | \`${acceptCommand(finding)}\` |`;
      },
      "findings",
    );
  }
  const outside = open.filter((finding) => !input.inlineDigests.has(finding.digest));
  if (outside.length > 0) {
    lines.push("Not inside this pull request's diff, so only listed here:", "");
    pushWithinBudget(
      outside,
      (finding) =>
        `- ${codeSpan(`${clip(finding.file, 300)}:${finding.line}`)} ${cell(finding.ruleTitle, 200)} (${finding.authority})`,
      "findings outside the diff",
    );
  }
  lines.push(
    'Human findings: comment `/agentlint approve <digest> --reason "..."` here, or reply `/agentlint approve <reason>` on the inline comment. ' +
      'Agent findings: run `agentlint accept <digest> --reason "..."` locally and push. ' +
      `Review everything locally with \`agentlint pr ${input.pullNumber}\`.`,
  );
  return lines.join("\n");
}

/** @param {Gate} gate */
function gateLabel(gate) {
  return gate === "open" ? "open" : gate === "closed" ? "closed" : "error";
}

const INLINE_CHECKS = 20;

/**
 * @param {Finding} finding
 * @returns {string}
 */
export function renderInlineBody(finding) {
  const lines = [
    inlineMarker(finding.digest),
    `### ${cell(finding.ruleTitle, 200)}`,
    "",
    authorityBadge(finding),
    "",
    clip(plain(finding.message), 2_000),
    "",
  ];
  // Every part is clipped, so the body stays under BODY_BUDGET without ever cutting through a fence.
  lines.push("**Standard**", "", clip(plain(finding.guidance.standard), 6_000), "");
  if (finding.guidance.checks.length > 0) {
    const checks = finding.guidance.checks.slice(0, INLINE_CHECKS);
    for (const check of checks) lines.push(`- ${cell(check, 500)}`);
    const hidden = finding.guidance.checks.length - checks.length;
    if (hidden > 0) lines.push(`- … and ${hidden} more checks — ${MORE}.`);
    lines.push("");
  }
  if (finding.proposal) {
    lines.push("**Agent proposal**", "", clip(plain(finding.proposal.summary), 4_000), "");
    if (finding.proposal.diff) {
      lines.push(
        "<details><summary>Proposed diff</summary>",
        "",
        fenced(clipDiff(finding.proposal.diff), "diff"),
        "",
        "</details>",
        "",
      );
    }
  }
  if (finding.lineageReason) {
    lines.push(`**Prior judgment (context only):** ${clip(plain(finding.lineageReason), 2_000)}`, "");
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
