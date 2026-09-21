// @ts-check
/**
 * `/agentlint ...` commands from issue comments and review comment replies: parsing (pure), the permission check, and
 * the approve / check flows.
 */

import { isRecord } from "./artifact.mjs";
import { git, gitOutput } from "./cli.mjs";
import { numberField, stringField } from "./github.mjs";
import {
  findSummary,
  installIfRequested,
  isFork,
  logCliOutput,
  publish,
  pullRequestFrom,
  recordOutputs,
  resolveBase,
  scan,
} from "./gate.mjs";
import { digestFromBody, headFromSummary, isActionComment, renderFailureReply } from "./render.mjs";

/**
 * @typedef {import("./gate.mjs").Context} Context
 */
/**
 * @typedef {import("./gate.mjs").PullRequest} PullRequest
 */

/**
 * @typedef {{ ok: true; name: "check" }
 *   | { ok: true; name: "approve"; selector: string; reason: string }
 *   | { ok: false; message: string }} Command
 */

const PREFIX = "/agentlint";
const DIGEST = /^[0-9a-f]{7,64}$/;
const FILE_LINE = /^[^\s"'`;&|$<>]+:\d+$/;
const REASON_LIMIT = 1000;

const USAGE =
  'Usage: `/agentlint approve <digest|path:line> --reason "why this satisfies the standard"`, `/agentlint check`, ' +
  "or reply `/agentlint approve <reason>` on an agentlint inline comment.";

/**
 * @param {string} raw
 */
function cleanReason(raw) {
  const trimmed = raw
    .trim()
    .replace(/^--reason\b\s*/, "")
    .trim();
  const unquoted = /^(["'])(.*)\1$/s.exec(trimmed)?.[2] ?? trimmed;
  return unquoted.trim().slice(0, REASON_LIMIT).trim();
}

/**
 * @param {string} selector
 */
export function isSelector(selector) {
  // A selector is passed to the CLI as an argument: it never looks like an option.
  return !selector.startsWith("-") && (DIGEST.test(selector) || FILE_LINE.test(selector));
}

/**
 * @param {string} body Comment body
 * @param {{ implicitSelector?: string | null }} [options] The digest of the parent inline comment, for replies
 * @returns {Command | null} `null` when the body is not an agentlint command
 */
export function parseCommand(body, options = {}) {
  const firstLine = body.trim().split(/\r?\n/)[0] ?? "";
  if (!firstLine.startsWith(PREFIX)) return null;
  const rest = firstLine.slice(PREFIX.length);
  if (rest !== "" && !/^\s/.test(rest)) return null;
  const words = rest
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const [verb, ...args] = words;
  if (verb === "check" && args.length === 0) return { ok: true, name: "check" };
  if (verb !== "approve") return { ok: false, message: USAGE };

  const implicit = options.implicitSelector ?? null;
  if (implicit) {
    const reason = cleanReason(args.join(" "));
    if (reason === "") return { ok: false, message: 'Reply "/agentlint approve <reason>" with a reason.' };
    return { ok: true, name: "approve", selector: implicit, reason };
  }

  const [selector, ...reasonWords] = args;
  if (!selector || !isSelector(selector)) return { ok: false, message: USAGE };
  const reasonText = reasonWords.join(" ");
  if (!reasonText.startsWith("--reason")) return { ok: false, message: USAGE };
  const reason = cleanReason(reasonText);
  if (reason === "") return { ok: false, message: USAGE };
  return { ok: true, name: "approve", selector, reason };
}

/**
 * @typedef {object} Surface
 * @property {number} pullNumber
 * @property {number} commentId
 * @property {string} body
 * @property {string} login
 * @property {number} userId
 * @property {boolean} isUser
 * @property {number | null} inReplyTo
 * @property {(body: string) => Promise<void>} reply
 * @property {(content: "-1" | "rocket") => Promise<void>} react
 */

/**
 * @param {Context} ctx
 * @returns {Surface | null}
 */
function surfaceFrom(ctx) {
  const comment = ctx.event["comment"];
  if (!isRecord(comment)) return null;
  const user = comment["user"];
  const commentId = numberField(comment["id"]) ?? 0;
  const common = {
    commentId,
    body: stringField(comment, "body"),
    login: stringField(user, "login"),
    userId: (isRecord(user) && numberField(user["id"])) || 0,
    isUser: stringField(user, "type") === "User",
  };
  if (ctx.eventName === "issue_comment") {
    const issue = ctx.event["issue"];
    if (!isRecord(issue) || !isRecord(issue["pull_request"])) return null;
    const pullNumber = numberField(issue["number"]) ?? 0;
    return {
      ...common,
      pullNumber,
      inReplyTo: null,
      reply: async (body) => {
        await ctx.github.write("POST", `/repos/${ctx.repository}/issues/${pullNumber}/comments`, { body });
      },
      react: async (content) => {
        await ctx.github.write("POST", `/repos/${ctx.repository}/issues/comments/${commentId}/reactions`, { content });
      },
    };
  }
  if (ctx.eventName === "pull_request_review_comment") {
    const pullNumber = pullRequestFrom(ctx.event["pull_request"]).number;
    return {
      ...common,
      pullNumber,
      inReplyTo: numberField(comment["in_reply_to_id"]),
      reply: async (body) => {
        await ctx.github.write("POST", `/repos/${ctx.repository}/pulls/${pullNumber}/comments/${commentId}/replies`, {
          body,
        });
      },
      react: async (content) => {
        await ctx.github.write("POST", `/repos/${ctx.repository}/pulls/comments/${commentId}/reactions`, { content });
      },
    };
  }
  return null;
}

/**
 * @param {Context} ctx
 * @param {string} login
 */
async function hasWriteAccess(ctx, login) {
  const data = await ctx.github.get(`/repos/${ctx.repository}/collaborators/${encodeURIComponent(login)}/permission`);
  return ["write", "maintain", "admin"].includes(stringField(data, "permission"));
}

/**
 * @param {Context} ctx
 * @param {Surface} surface
 * @returns {Promise<string | null>}
 */
async function implicitSelector(ctx, surface) {
  if (surface.inReplyTo === null) return null;
  const parent = await ctx.github.get(`/repos/${ctx.repository}/pulls/comments/${surface.inReplyTo}`);
  return isActionComment(parent, await ctx.github.identity()) ? digestFromBody(stringField(parent, "body")) : null;
}

/**
 * @param {Context} ctx
 * @param {PullRequest} pull
 */
async function checkoutHead(ctx, pull) {
  const cwd = ctx.workingDirectory;
  // The branch name comes from the pull request. It is passed as a full ref, never where Git reads an option.
  if (pull.headRef.startsWith("-")) throw new Error(`unsupported head branch name: ${pull.headRef}`);
  const tracking = `refs/remotes/origin/${pull.headRef}`;
  const fetched = await ctx.github.gitFetch(["--no-tags", "origin", `+refs/heads/${pull.headRef}:${tracking}`], cwd);
  if (fetched.code !== 0) throw new Error(`git fetch origin ${pull.headRef} failed: ${fetched.stderr.trim()}`);
  // `--force`: a retry starts again from the remote head and drops the local acceptance commit and any install residue.
  const checkedOut = await git(["checkout", "--force", "-B", pull.headRef, tracking, "--"], cwd);
  if (checkedOut.code !== 0) throw new Error(`git checkout ${pull.headRef} failed: ${checkedOut.stderr.trim()}`);
}

/**
 * A digest names one finding and its evidence, and so does the marker of an inline thread. `path:line` names whatever
 * finding sits on that line when the queued job runs, which a push in between can change. It is accepted only while the
 * checked-out head is the one the action's latest summary was rendered for, which is what the reviewer read.
 *
 * @param {Context} ctx
 * @param {Surface} surface
 * @param {string} selector
 * @returns {Promise<string | null>} The refusal, or `null` when the selector may be used
 */
async function staleSelectorRefusal(ctx, surface, selector) {
  if (DIGEST.test(selector)) return null;
  const head = await gitOutput(["rev-parse", "HEAD"], ctx.workingDirectory);
  const summary = await findSummary(ctx, surface.pullNumber);
  const seen = summary === undefined ? null : headFromSummary(stringField(summary, "body"));
  if (seen !== null && head.startsWith(seen)) return null;
  const evidence =
    seen === null
      ? "there is no agentlint summary for it yet"
      : `the latest agentlint summary is for \`${seen.slice(0, 7)}\``;
  return (
    `\`${selector}\` was not approved: the pull request head is \`${head.slice(0, 7)}\` and ${evidence}, so the finding on ` +
    "that line may not be the one you reviewed. Check the current summary and approve by digest: " +
    '`/agentlint approve <digest> --reason "..."`.'
  );
}

const PUSH_ATTEMPTS = 3;

/**
 * @param {string} stderr Of a failed `git push`
 */
function headMoved(stderr) {
  return /\[rejected\]|non-fast-forward|fetch first/.test(stderr);
}

/**
 * @param {string} message CLI success message, `Accepted <ruleId> at <file>:<line>.`
 * @param {string} fallback
 */
function commitSubject(message, fallback) {
  const match = /^Accepted (\S+) at (\S+?)\.?$/m.exec(message.trim());
  return match ? `chore(agentlint): accept ${match[1]} at ${match[2]}` : `chore(agentlint): accept ${fallback}`;
}

/**
 * @param {Context} ctx
 * @param {Surface} surface
 * @param {PullRequest} pull
 * @param {string} base
 * @param {{ selector: string; reason: string }} command
 * @returns {Promise<"pushed" | "refused" | "moved" | "failed">} `refused` and `failed` have replied to the commenter
 */
async function approveOnce(ctx, surface, pull, base, command) {
  const stale = await staleSelectorRefusal(ctx, surface, command.selector);
  if (stale !== null) {
    await surface.reply(stale);
    return "refused";
  }
  const result = await ctx.cli.run(["approve", command.selector, "--reason", command.reason, "--base", base], {
    AGENTLINT_ACTOR: `human:${surface.login}`,
  });
  const message = (result.stdout + result.stderr).trim();
  logCliOutput(ctx, message);
  if (result.code !== 0) {
    await surface.reply(renderFailureReply("agentlint could not record the approval:", message));
    return "refused";
  }
  const cwd = ctx.workingDirectory;
  const added = await git(["add", "--", ".agentlint/acceptances.jsonl"], cwd);
  if (added.code !== 0) throw new Error(`git add failed: ${added.stderr.trim()}`);
  const author = `${surface.login} <${surface.userId}+${surface.login}@users.noreply.github.com>`;
  const committed = await git(
    [
      "commit",
      `--author=${author}`,
      "-m",
      commitSubject(message, command.selector),
      "-m",
      `Approved-by: @${surface.login}`,
    ],
    cwd,
    {
      ...ctx.env,
      GIT_COMMITTER_NAME: "github-actions[bot]",
      GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    },
  );
  if (committed.code !== 0) throw new Error(`git commit failed: ${committed.stderr.trim()}`);
  // The push authenticates with the `github-token` input for this one command; see `gitAuthOptions`.
  const pushed = await ctx.github.gitWrite(["origin", `HEAD:refs/heads/${pull.headRef}`], cwd);
  if (pushed.code === 0) return "pushed";
  if (headMoved(pushed.stderr)) return "moved";
  await surface.reply(
    renderFailureReply(
      `agentlint recorded the approval but could not push it to \`${pull.headRef}\`, so nothing changed. The \`github-token\` needs \`contents: write\`, and the branch rules must let it push.`,
      pushed.stderr,
    ),
  );
  return "failed";
}

/**
 * Another push (a second approval, a new commit) can move the branch between the fetch and the push. The approval is
 * then applied again on the new head, where the CLI checks the evidence again, a bounded number of times. Correctness
 * does not depend on the workflow serialising its runs.
 *
 * @param {Context} ctx
 * @param {Surface} surface
 * @param {PullRequest} pull
 * @param {string} base
 * @param {{ selector: string; reason: string }} command
 * @returns {Promise<"pushed" | "refused" | "failed">}
 */
async function approve(ctx, surface, pull, base, command) {
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      ctx.log.warn(`${pull.headRef} moved during the push; applying the approval again (attempt ${attempt})`);
      await checkoutHead(ctx, pull);
    }
    const outcome = await approveOnce(ctx, surface, pull, base, command);
    if (outcome !== "moved") return outcome;
  }
  await surface.reply(
    `agentlint could not push the approval: \`${pull.headRef}\` moved ${PUSH_ATTEMPTS} times while it was being recorded. Nothing changed; send the command again.`,
  );
  return "failed";
}

/**
 * @param {Context} ctx
 * @returns {Promise<number>}
 */
export async function runCommand(ctx) {
  if (stringField(ctx.event, "action") !== "created") return 0;
  const surface = surfaceFrom(ctx);
  if (!surface || !surface.body.trimStart().startsWith(PREFIX)) {
    ctx.log.info("not an agentlint command");
    return 0;
  }
  if (!surface.isUser) {
    ctx.log.info(`ignoring command from ${surface.login}: not a user account`);
    return 0;
  }
  const rawPull = await ctx.github.get(`/repos/${ctx.repository}/pulls/${surface.pullNumber}`);
  const pull = pullRequestFrom(rawPull);
  if (pull.headRef === "") throw new Error(`pull request #${surface.pullNumber} could not be read`);
  if (isFork(ctx, pull)) {
    await surface.reply(
      "agentlint cannot approve from GitHub on a fork pull request. Run `agentlint approve` locally and push.",
    );
    return 0;
  }
  if (!(await hasWriteAccess(ctx, surface.login))) {
    await surface.react("-1");
    await surface.reply(`@${surface.login} needs write access to this repository to run agentlint commands.`);
    return 0;
  }
  const implicit = await implicitSelector(ctx, surface);
  if (surface.inReplyTo !== null && implicit === null) {
    await surface.reply(
      'Reply to an agentlint inline comment, or use `/agentlint approve <digest> --reason "..."` on the pull request.',
    );
    return 0;
  }
  const command = parseCommand(surface.body, { implicitSelector: implicit });
  if (command === null) return 0;
  if (!command.ok) {
    await surface.reply(command.message);
    return 0;
  }

  // Both fetches happen before any repository code runs.
  await checkoutHead(ctx, pull);
  const base = await resolveBase(ctx, ctx.inputs.base || pull.baseRef);
  await installIfRequested(ctx);
  if (command.name === "approve") {
    const outcome = await approve(ctx, surface, pull, base, command);
    // A refusal is an answer to the commenter. A push that did not happen is a failed run.
    if (outcome !== "pushed") return outcome === "refused" ? 0 : 1;
  }

  const headSha = await gitOutput(["rev-parse", "HEAD"], ctx.workingDirectory);
  const result = await scan(ctx, base);
  recordOutputs(ctx, result);
  await publish(ctx, { ...pull, headSha }, result);
  await surface.react("rocket");
  return 0;
}
