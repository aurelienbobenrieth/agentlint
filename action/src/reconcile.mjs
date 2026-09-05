// @ts-check
/**
 * Reconciliation plan between the current findings and the inline review
 * threads the action created earlier on the same pull request.
 */

import { isCommentable } from "./diff.mjs";

/** @typedef {import("./artifact.mjs").Finding} Finding */

/**
 * @typedef {object} Thread
 * @property {number} commentId database id of the thread's first comment
 * @property {string} digest fingerprint digest from the inline marker
 * @property {boolean} resolved
 * @property {string | null} threadId GraphQL review thread id, when known
 */

/**
 * @typedef {object} Resolution
 * @property {Thread} thread
 * @property {string} reply
 */

/**
 * @typedef {object} Plan
 * @property {Finding[]} create unresolved findings that need a new inline comment
 * @property {Resolution[]} resolve threads to reply to once and resolve
 * @property {Thread[]} leave threads that still match an unresolved finding or are already resolved
 * @property {Finding[]} outside unresolved findings without a thread that cannot be commented inline
 */

/**
 * @param {Finding | undefined} finding
 * @returns {string}
 */
function resolutionReply(finding) {
  if (finding?.status === "accepted" && finding.acceptance) {
    return `Resolved: accepted by ${finding.acceptance.actor} — ${finding.acceptance.reason}`;
  }
  return "Resolved: the finding no longer exists";
}

/**
 * @param {object} input
 * @param {ReadonlyArray<Finding>} input.findings every finding in the artifact, accepted ones included
 * @param {ReadonlyArray<Thread>} input.threads
 * @param {Map<string, Set<number>>} input.commentable
 * @returns {Plan}
 */
export function planReconciliation(input) {
  const byDigest = new Map(input.findings.map((finding) => [finding.digest, finding]));
  const threadDigests = new Set(input.threads.map((thread) => thread.digest));
  /** @type {Plan} */
  const plan = { create: [], resolve: [], leave: [], outside: [] };

  for (const finding of input.findings) {
    if (finding.status !== "unresolved") continue;
    if (threadDigests.has(finding.digest)) continue;
    if (isCommentable(input.commentable, finding)) plan.create.push(finding);
    else plan.outside.push(finding);
  }

  for (const thread of input.threads) {
    const finding = byDigest.get(thread.digest);
    if (finding?.status === "unresolved" || thread.resolved) {
      plan.leave.push(thread);
      continue;
    }
    plan.resolve.push({ thread, reply: resolutionReply(finding) });
  }

  return plan;
}
