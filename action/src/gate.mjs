// @ts-check
/**
 * The `pull_request` flow: run `check`, read the artifact, then publish the result as the `agentlint` check run, the
 * sticky summary comment, and inline review comments reconciled with the threads from earlier runs.
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRecord, readArtifact } from "./artifact.mjs";
import { childEnv, exec, git, gitOutput } from "./cli.mjs";
import { commentableByFile } from "./diff.mjs";
import { numberField, stringField } from "./github.mjs";
import { installCommand } from "./inputs.mjs";
import { planReconciliation } from "./reconcile.mjs";
import {
  SUMMARY_MARKER,
  countFindings,
  digestFromBody,
  isActionComment,
  renderAnnotations,
  renderCheckOutput,
  renderInlineBody,
  renderReviewBody,
  renderSummary,
  renderWorkflowCommands,
} from "./render.mjs";

/**
 * @typedef {import("./artifact.mjs").Finding} Finding
 */
/**
 * @typedef {import("./render.mjs").Gate} Gate
 */
/**
 * @typedef {import("./reconcile.mjs").Thread} ReviewThread
 */

/**
 * @typedef {object} Context
 * @property {import("./inputs.mjs").Inputs} inputs
 * @property {NodeJS.ProcessEnv} env
 * @property {string} eventName
 * @property {Record<string, unknown>} event
 * @property {string} repository Owner/name
 * @property {string} serverUrl
 * @property {string} workspace
 * @property {string} workingDirectory Absolute
 * @property {import("./github.mjs").GitHub} github
 * @property {import("./cli.mjs").Cli} cli
 * @property {import("./github.mjs").Logger} log
 * @property {Map<string, string>} outputs
 */

/**
 * @typedef {object} Scan
 * @property {Gate} gate
 * @property {number} code
 * @property {ReadonlyArray<Finding>} findings
 * @property {string} artifactPath
 */

/**
 * @typedef {object} PullRequest
 * @property {number} number
 * @property {string} headSha
 * @property {string} headRef
 * @property {string} baseRef
 * @property {string} headRepo Full name
 */

const ANNOTATION_BATCH = 50;
/**
 * @type {Gate}
 */
const OPEN_GATE = "open";
/**
 * @type {Gate}
 */
const CLOSED_GATE = "closed";
/**
 * @type {Gate}
 */
const ERROR_GATE = "error";

/**
 * @param {number} code @returns {Gate}
 */
function gateFromExit(code) {
  if (code === 0) return OPEN_GATE;
  if (code === 1) return CLOSED_GATE;
  return ERROR_GATE;
}

/**
 * @param {unknown} pull Raw pull request object from an event or the API
 * @returns {PullRequest}
 */
export function pullRequestFrom(pull) {
  const head = isRecord(pull) ? pull["head"] : undefined;
  const base = isRecord(pull) ? pull["base"] : undefined;
  const headRepo = isRecord(head) ? head["repo"] : undefined;
  return {
    number: (isRecord(pull) && numberField(pull["number"])) || 0,
    headSha: stringField({ record: head, key: "sha" }),
    headRef: stringField({ record: head, key: "ref" }),
    baseRef: stringField({ record: base, key: "ref" }),
    headRepo: stringField({ record: headRepo, key: "full_name" }),
  };
}

/**
 * The ref passed to `--base`. A branch name, slashes included (`release/1.x`), becomes `origin/<base>`, fetched when
 * the checkout does not have it. Only `HEAD`, `origin/...`, and `refs/...` are explicit refs and pass through.
 *
 * @param {object} input
 * @param {Context} input.ctx
 * @param {string} input.base
 */
export async function resolveBase({ ctx, base }) {
  const cwd = ctx.workingDirectory;
  if (base === "" || base === "HEAD") return "HEAD";
  // The value is a workflow input or the pull request's base branch. It is never placed where Git reads an option.
  if (base.startsWith("-")) throw new Error(`unsupported base ref: ${base}`);
  if (base.startsWith("origin/") || base.startsWith("refs/")) return base;
  const remote = `origin/${base}`;
  const tracking = `refs/remotes/origin/${base}`;
  const exists = async () => (await git({ args: ["rev-parse", "--verify", "--quiet", tracking], cwd })).code === 0;
  if (await exists()) return remote;
  const fetched = await ctx.github.gitFetch({ args: ["--no-tags", "origin", `+refs/heads/${base}:${tracking}`], cwd });
  if (fetched.code === 0 && (await exists())) return remote;
  ctx.log.warn(`base ${remote} is not available; using ${base} as given`);
  return base;
}

/**
 * @param {Context} ctx
 */
export async function installIfRequested(ctx) {
  if (!ctx.inputs.install) return;
  for (const dir of [ctx.workingDirectory, ctx.workspace]) {
    const command = installCommand(await readdir(dir));
    if (!command) continue;
    ctx.log.info(`install: ${command.join(" ")} in ${dir}`);
    // Package managers are `.cmd` shims on Windows. Invoke the command processor explicitly so `execFile` keeps its
    // shell-free contract and Node does not concatenate arbitrary argv. Every token below is a fixed literal selected
    // from the lockfile name; no repository or pull request text reaches the command string.
    const argv =
      process.platform === "win32" ? [ctx.env["ComSpec"] ?? "cmd.exe", "/d", "/s", "/c", command.join(" ")] : command;
    // Lifecycle scripts are repository code: they get the environment without the token or any other credential.
    const installed = await exec({
      argv,
      options: { cwd: dir, env: childEnv(ctx.env) },
    });
    if (installed.code !== 0) throw new Error(`install failed:\n${installed.stderr}`);
    return;
  }
  ctx.log.warn("install requested but no lockfile found");
}

/**
 * CLI output quotes repository content: messages, excerpts, file names. A line that starts with `::` would otherwise
 * run as a workflow command, so the runner's command processing is suspended while the output is printed.
 *
 * @param {object} input
 * @param {Context} input.ctx
 * @param {string} input.output
 */
export function logCliOutput({ ctx, output }) {
  if (output.trim() === "") return;
  const token = randomUUID();
  ctx.log.info(`::stop-commands::${token}`);
  ctx.log.info(output.trimEnd());
  ctx.log.info(`::${token}::`);
}

/**
 * Run `check --all --review-output` and read the artifact back.
 *
 * @param {object} input
 * @param {Context} input.ctx
 * @param {string} input.base
 * @returns {Promise<Scan>}
 */
export async function scan({ ctx, base }) {
  const dir = await mkdtemp(join(ctx.env["RUNNER_TEMP"] ?? tmpdir(), "agentlint-"));
  const artifactPath = join(dir, "agentlint-review.json");
  const result = await ctx.cli.run({ args: ["check", "--all", "--base", base, "--review-output", artifactPath] });
  logCliOutput({ ctx, output: result.stdout });
  logCliOutput({ ctx, output: result.stderr });
  if (result.code !== 0 && result.code !== 1) {
    return { gate: "error", code: result.code, findings: [], artifactPath: "" };
  }
  const artifact = await readArtifact(artifactPath);
  return { gate: gateFromExit(result.code), code: result.code, findings: artifact.findings, artifactPath };
}

/**
 * @param {object} input
 * @param {Context} input.ctx
 * @param {string} input.headSha
 * @param {Scan} input.result
 */
async function publishCheckRun({ ctx, headSha, result }) {
  const annotations = renderAnnotations(result.findings);
  const output = renderCheckOutput({ gate: result.gate, findings: result.findings });
  const conclusion = result.gate === "open" ? "success" : result.gate === "closed" ? "failure" : "action_required";
  const created = await ctx.github.write({
    method: "POST",
    path: `/repos/${ctx.repository}/check-runs`,
    body: {
      name: "agentlint",
      head_sha: headSha,
      status: "completed",
      conclusion,
      output: { ...output, annotations: annotations.slice(0, ANNOTATION_BATCH) },
    },
  });
  const id = isRecord(created) ? numberField(created["id"]) : null;
  // A dry run records the plan under a placeholder. A real run without an id has no check run to extend.
  if (id === null && !ctx.inputs.dryRun && annotations.length > ANNOTATION_BATCH) {
    throw new Error("GitHub created the check run without an id, so its remaining annotations cannot be attached");
  }
  for (const offset of Array.from(
    { length: Math.ceil(Math.max(0, annotations.length - ANNOTATION_BATCH) / ANNOTATION_BATCH) },
    (_, index) => ANNOTATION_BATCH * (index + 1),
  )) {
    await ctx.github.write({
      method: "PATCH",
      path: `/repos/${ctx.repository}/check-runs/${id ?? "dry-run"}`,
      body: {
        output: { ...output, annotations: annotations.slice(offset, offset + ANNOTATION_BATCH) },
      },
    });
  }
}

/**
 * The sticky summary that this action's own account posted, if any.
 *
 * @param {object} input
 * @param {Context} input.ctx
 * @param {number} input.pullNumber
 * @returns {Promise<unknown>}
 */
export async function findSummary({ ctx, pullNumber }) {
  const comments = await ctx.github.paginate(`/repos/${ctx.repository}/issues/${pullNumber}/comments`);
  const identity = await ctx.github.identity();
  // The newest one: the action edits a single summary in place, so there is normally exactly one.
  return comments.findLast(
    (comment) =>
      isActionComment({ comment, identity }) && stringField({ record: comment, key: "body" }).includes(SUMMARY_MARKER),
  );
}

/**
 * @param {object} input
 * @param {Context} input.ctx
 * @param {number} input.pullNumber
 * @param {string} input.body
 */
async function upsertSummary({ ctx, pullNumber, body }) {
  const existing = await findSummary({ ctx, pullNumber });
  const id = isRecord(existing) ? numberField(existing["id"]) : null;
  if (id !== null) {
    await ctx.github.write({ method: "PATCH", path: `/repos/${ctx.repository}/issues/comments/${id}`, body: { body } });
  } else {
    await ctx.github.write({
      method: "POST",
      path: `/repos/${ctx.repository}/issues/${pullNumber}/comments`,
      body: { body },
    });
  }
}

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`;

/**
 * Map from first-comment database id to review thread id and resolved state.
 *
 * @param {object} input
 * @param {Context} input.ctx
 * @param {number} input.pullNumber
 * @returns {Promise<Map<number, { threadId: string; resolved: boolean }>>}
 */
async function reviewThreads({ ctx, pullNumber }) {
  const [owner, name] = ctx.repository.split("/");
  /**
   * @type {Map<number, { threadId: string; resolved: boolean }>}
   */
  const map = new Map();
  /**
   * @type {{ after: string | null }}
   */
  const pagination = { after: null };
  const seen = new Set();
  for (;;) {
    const data = await ctx.github.graphql({
      query: THREADS_QUERY,
      variables: { owner, name, number: pullNumber, after: pagination.after },
    });
    const repository = isRecord(data) ? data["repository"] : undefined;
    const pull = isRecord(repository) ? repository["pullRequest"] : undefined;
    const threads = isRecord(pull) ? pull["reviewThreads"] : undefined;
    if (!isRecord(threads)) return map;
    const nodes = Array.isArray(threads["nodes"]) ? threads["nodes"] : [];
    for (const node of nodes) {
      if (!isRecord(node)) continue;
      const comments = isRecord(node["comments"]) ? node["comments"]["nodes"] : undefined;
      const first = Array.isArray(comments) ? comments[0] : undefined;
      const databaseId = isRecord(first) ? numberField(first["databaseId"]) : null;
      if (databaseId === null) continue;
      map.set(databaseId, {
        threadId: stringField({ record: node, key: "id" }),
        resolved: node["isResolved"] === true,
      });
    }
    const pageInfo = threads["pageInfo"];
    if (!isRecord(pageInfo) || pageInfo["hasNextPage"] !== true) return map;
    pagination.after = stringField({ record: pageInfo, key: "endCursor" });
    if (!pagination.after || seen.has(pagination.after) || seen.size >= 1_000)
      throw new Error("GitHub review pagination returned an invalid cursor or exceeded 1000 pages");
    seen.add(pagination.after);
  }
}

/**
 * Existing agentlint inline threads on the pull request, keyed by digest.
 *
 * @param {object} input
 * @param {Context} input.ctx
 * @param {number} input.pullNumber
 * @returns {Promise<ReviewThread[]>}
 */
async function existingThreads({ ctx, pullNumber }) {
  const comments = await ctx.github.paginate(`/repos/${ctx.repository}/pulls/${pullNumber}/comments`);
  const threads = await reviewThreads({ ctx, pullNumber });
  const identity = await ctx.github.identity();
  /**
   * @type {ReviewThread[]}
   */
  const result = [];
  for (const comment of comments) {
    if (!isRecord(comment) || !isActionComment({ comment, identity }) || comment["in_reply_to_id"] !== undefined)
      continue;
    const digest = digestFromBody(stringField({ record: comment, key: "body" }));
    const commentId = numberField(comment["id"]);
    if (digest === null || commentId === null) continue;
    const thread = threads.get(commentId);
    result.push({ commentId, digest, resolved: thread?.resolved ?? false, threadId: thread?.threadId ?? null });
  }
  return result;
}

/**
 * @param {object} input
 * @param {Context} input.ctx
 * @param {PullRequest} input.pull
 * @param {Scan} input.result
 * @returns {Promise<Set<string>>} Digests that have an inline thread after this run
 */
async function publishInline({ ctx, pull, result }) {
  const files = await ctx.github.paginate(`/repos/${ctx.repository}/pulls/${pull.number}/files`);
  const commentable = commentableByFile(
    files.filter(isRecord).map((file) => {
      const patch = typeof file["patch"] === "string" ? file["patch"] : undefined;
      const filename = stringField({ record: file, key: "filename" });
      const status = stringField({ record: file, key: "status" });
      return patch === undefined ? { filename, status } : { filename, patch, status };
    }),
  );
  const threads = await existingThreads({ ctx, pullNumber: pull.number });
  const plan = planReconciliation({ findings: result.findings, threads, commentable });
  ctx.log.info(
    `inline: ${plan.create.length} new, ${plan.resolve.length} to resolve, ${plan.leave.length} unchanged, ${plan.outside.length} outside the diff`,
  );

  if (plan.create.length > 0) {
    await ctx.github.write({
      method: "POST",
      path: `/repos/${ctx.repository}/pulls/${pull.number}/reviews`,
      body: {
        commit_id: pull.headSha,
        event: "COMMENT",
        body: renderReviewBody(plan.create.length),
        comments: plan.create.map((finding) => ({
          path: finding.file,
          line: finding.line,
          side: "RIGHT",
          body: renderInlineBody(finding),
        })),
      },
    });
  }
  for (const { thread, reply } of plan.resolve) {
    await ctx.github.write({
      method: "POST",
      path: `/repos/${ctx.repository}/pulls/${pull.number}/comments/${thread.commentId}/replies`,
      body: {
        body: reply,
      },
    });
    if (thread.threadId) await ctx.github.mutate({ query: RESOLVE_MUTATION, variables: { threadId: thread.threadId } });
    else ctx.log.warn(`thread for comment ${thread.commentId} has no GraphQL id; left unresolved`);
  }
  const reconciledThreads = [...plan.leave, ...plan.resolve.map((entry) => entry.thread)];
  return new Set([
    ...reconciledThreads.map((thread) => thread.digest),
    ...plan.create.map((finding) => finding.digest),
  ]);
}

/**
 * Publish a scan for a same-repository pull request: check run, sticky summary, inline comments.
 *
 * @param {object} input
 * @param {Context} input.ctx
 * @param {PullRequest} input.pull
 * @param {Scan} input.result
 */
export async function publish({ ctx, pull, result }) {
  await publishCheckRun({ ctx, headSha: pull.headSha, result });
  if (!ctx.inputs.comment) return;
  const inlineDigests = await publishInline({ ctx, pull, result });
  await upsertSummary({
    ctx,
    pullNumber: pull.number,
    body: renderSummary({
      repository: ctx.repository,
      headSha: pull.headSha,
      pullNumber: pull.number,
      gate: result.gate,
      findings: result.findings,
      inlineDigests,
      serverUrl: ctx.serverUrl,
    }),
  });
}

/**
 * @param {object} input
 * @param {Context} input.ctx
 * @param {Scan} input.result
 */
export function recordOutputs({ ctx, result }) {
  const counts = countFindings(result.findings);
  ctx.outputs.set("gate", result.gate);
  ctx.outputs.set("unresolved", String(counts.unresolved));
  ctx.outputs.set("human", String(counts.human));
  ctx.outputs.set("artifact", result.artifactPath);
}

const FORK_NOTICE =
  "Fork pull request: the token is read-only, so no agentlint check run or comment is written, and this job's status " +
  "comes from the fork's own configuration and acceptances, so it is not a trustworthy gate. A maintainer pushes the " +
  "commits to a branch in this repository to run the real gate.";

/**
 * @param {object} input
 * @param {Context} input.ctx
 * @param {string} input.markdown
 */
async function appendSummary({ ctx, markdown }) {
  const path = ctx.env["GITHUB_STEP_SUMMARY"];
  if (path) await appendFile(path, markdown, "utf8");
}

/**
 * @param {object} input
 * @param {Context} input.ctx
 * @param {PullRequest} input.pull
 */
export function isFork({ ctx, pull }) {
  // A deleted head repository reports no name. Treat it as a fork: never push to or comment for an unknown origin.
  return pull.headRepo !== ctx.repository;
}

/**
 * @param {Context} ctx
 * @returns {Promise<number>} Exit code of the step: the gate code
 */
export async function runGate(ctx) {
  const action = stringField({ record: ctx.event, key: "action" });
  if (!["opened", "synchronize", "reopened", "ready_for_review"].includes(action)) {
    ctx.log.info(`pull_request.${action}: nothing to do`);
    return 0;
  }
  const pull = pullRequestFrom(ctx.event["pull_request"]);
  const headSha = pull.headSha || (await gitOutput({ args: ["rev-parse", "HEAD"], cwd: ctx.workingDirectory }));
  // The base is fetched before any repository code runs.
  const base = await resolveBase({ ctx, base: ctx.inputs.base || pull.baseRef });
  await installIfRequested(ctx);
  const result = await scan({ ctx, base });
  recordOutputs({ ctx, result });

  if (isFork({ ctx, pull })) {
    ctx.log.warn(FORK_NOTICE);
    await appendSummary({
      ctx,
      markdown: `### agentlint

${FORK_NOTICE}
`,
    });
    for (const line of renderWorkflowCommands(result.findings)) ctx.log.info(line);
    return result.code;
  }
  await publish({ ctx, pull: { ...pull, headSha }, result });
  return result.code;
}
