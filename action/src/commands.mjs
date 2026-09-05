// @ts-check
/**
 * `/agentlint ...` commands from issue comments and review comment replies:
 * parsing (pure), the permission check, and the approve / check flows.
 */

import { isRecord } from "./artifact.mjs";
import { git, gitOutput } from "./cli.mjs";
import { numberField, stringField } from "./github.mjs";
import { installIfRequested, isFork, publish, pullRequestFrom, recordOutputs, resolveBase, scan } from "./gate.mjs";
import { digestFromBody } from "./render.mjs";

/** @typedef {import("./gate.mjs").Context} Context */
/** @typedef {import("./gate.mjs").PullRequest} PullRequest */

/**
 * @typedef {{ ok: true, name: "check" } | { ok: true, name: "approve", selector: string, reason: string } | { ok: false, message: string }} Command
 */

const PREFIX = "/agentlint";
const DIGEST = /^[0-9a-f]{7,64}$/;
const FILE_LINE = /^[^\s"'`;&|$<>]+:\d+$/;
const REASON_LIMIT = 1000;

const USAGE =
  'Usage: `/agentlint approve <digest|path:line> --reason "why this satisfies the standard"`, `/agentlint check`, ' +
  "or reply `/agentlint approve <reason>` on an agentlint inline comment.";

/** @param {string} raw */
function cleanReason(raw) {
  const trimmed = raw
    .trim()
    .replace(/^--reason\b\s*/, "")
    .trim();
  const unquoted = /^(["'])(.*)\1$/s.exec(trimmed)?.[2] ?? trimmed;
  return unquoted.trim().slice(0, REASON_LIMIT).trim();
}

/** @param {string} selector */
export function isSelector(selector) {
  return DIGEST.test(selector) || FILE_LINE.test(selector);
}

/**
 * @param {string} body comment body
 * @param {{ implicitSelector?: string | null }} [options] the digest of the parent inline comment, for replies
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
export function surfaceFrom(ctx) {
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
export async function hasWriteAccess(ctx, login) {
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
  return digestFromBody(stringField(parent, "body"));
}

/**
 * @param {Context} ctx
 * @param {PullRequest} pull
 */
async function checkoutHead(ctx, pull) {
  const cwd = ctx.workingDirectory;
  const fetched = await git(["fetch", "--no-tags", "origin", pull.headRef], cwd);
  if (fetched.code !== 0) throw new Error(`git fetch origin ${pull.headRef} failed: ${fetched.stderr.trim()}`);
  const checkedOut = await git(["checkout", "-B", pull.headRef, `origin/${pull.headRef}`], cwd);
  if (checkedOut.code !== 0) throw new Error(`git checkout ${pull.headRef} failed: ${checkedOut.stderr.trim()}`);
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
 * @param {{ selector: string, reason: string }} command
 * @returns {Promise<boolean>} whether the acceptance was recorded and pushed
 */
async function approve(ctx, surface, pull, base, command) {
  const result = await ctx.cli.run(["approve", command.selector, "--reason", command.reason, "--base", base], {
    AGENTLINT_ACTOR: `human:${surface.login}`,
  });
  const message = (result.stdout + result.stderr).trim();
  ctx.log.info(message);
  if (result.code !== 0) {
    await surface.reply(`agentlint could not record the approval:\n\n\`\`\`\n${message}\n\`\`\``);
    return false;
  }
  const cwd = ctx.workingDirectory;
  const added = await git(["add", ".agentlint/acceptances.jsonl"], cwd);
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
  await ctx.github.gitWrite(["push", "origin", `HEAD:${pull.headRef}`], cwd);
  return true;
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

  await checkoutHead(ctx, pull);
  await installIfRequested(ctx);
  const base = await resolveBase(ctx, ctx.inputs.base || pull.baseRef);
  if (command.name === "approve" && !(await approve(ctx, surface, pull, base, command))) return 0;

  const headSha = await gitOutput(["rev-parse", "HEAD"], ctx.workingDirectory);
  const result = await scan(ctx, base);
  recordOutputs(ctx, result);
  await publish(ctx, { ...pull, headSha }, result);
  await surface.react("rocket");
  return 0;
}
