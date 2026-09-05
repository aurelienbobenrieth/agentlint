// @ts-check
/**
 * The `pull_request` flow: run `check`, read the artifact, then publish the
 * result as the `agentlint` check run, the sticky summary comment, and inline
 * review comments reconciled with the threads from earlier runs.
 */

import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRecord, readArtifact } from "./artifact.mjs";
import { exec, git, gitOutput } from "./cli.mjs";
import { commentableByFile } from "./diff.mjs";
import { numberField, stringField } from "./github.mjs";
import { installCommand } from "./inputs.mjs";
import { planReconciliation } from "./reconcile.mjs";
import {
  SUMMARY_MARKER,
  countFindings,
  digestFromBody,
  renderAnnotations,
  renderCheckOutput,
  renderInlineBody,
  renderReviewBody,
  renderSummary,
  renderWorkflowCommands,
} from "./render.mjs";

/** @typedef {import("./artifact.mjs").Finding} Finding */
/** @typedef {import("./render.mjs").Gate} Gate */
/** @typedef {import("./reconcile.mjs").Thread} ReviewThread */

/**
 * @typedef {object} Context
 * @property {import("./inputs.mjs").Inputs} inputs
 * @property {NodeJS.ProcessEnv} env
 * @property {string} eventName
 * @property {Record<string, unknown>} event
 * @property {string} repository owner/name
 * @property {string} serverUrl
 * @property {string} workspace
 * @property {string} workingDirectory absolute
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
 * @property {string} headRepo full name
 */

const ANNOTATION_BATCH = 50;

/** @param {number} code @returns {Gate} */
export function gateFromExit(code) {
  return code === 0 ? "open" : code === 1 ? "closed" : "error";
}

/**
 * @param {unknown} pull raw pull request object from an event or the API
 * @returns {PullRequest}
 */
export function pullRequestFrom(pull) {
  const head = isRecord(pull) ? pull["head"] : undefined;
  const base = isRecord(pull) ? pull["base"] : undefined;
  const headRepo = isRecord(head) ? head["repo"] : undefined;
  return {
    number: (isRecord(pull) && numberField(pull["number"])) || 0,
    headSha: stringField(head, "sha"),
    headRef: stringField(head, "ref"),
    baseRef: stringField(base, "ref"),
    headRepo: stringField(headRepo, "full_name"),
  };
}

/**
 * The ref passed to `--base`: `origin/<base>` when it exists locally or can be
 * fetched, otherwise the input as given (so `HEAD` and explicit refs work).
 *
 * @param {Context} ctx
 * @param {string} base
 */
export async function resolveBase(ctx, base) {
  const cwd = ctx.workingDirectory;
  if (base === "" || base === "HEAD" || base.includes("/")) return base === "" ? "HEAD" : base;
  const remote = `origin/${base}`;
  if ((await git(["rev-parse", "--verify", "--quiet", remote], cwd)).code === 0) return remote;
  const fetched = await git(["fetch", "--no-tags", "origin", base], cwd);
  if (fetched.code === 0 && (await git(["rev-parse", "--verify", "--quiet", remote], cwd)).code === 0) return remote;
  ctx.log.warn(`base ${remote} is not available; using ${base} as given`);
  return base;
}

/** @param {Context} ctx */
export async function installIfRequested(ctx) {
  if (!ctx.inputs.install) return;
  for (const dir of [ctx.workingDirectory, ctx.workspace]) {
    const command = installCommand(await readdir(dir));
    if (!command) continue;
    ctx.log.info(`install: ${command.join(" ")} in ${dir}`);
    const installed = await exec(command, { cwd: dir, env: ctx.env });
    if (installed.code !== 0) throw new Error(`install failed:\n${installed.stderr}`);
    return;
  }
  ctx.log.warn("install requested but no lockfile found");
}

/**
 * Run `check --all --review-output` and read the artifact back.
 *
 * @param {Context} ctx
 * @param {string} base
 * @returns {Promise<Scan>}
 */
export async function scan(ctx, base) {
  const dir = await mkdtemp(join(ctx.env["RUNNER_TEMP"] ?? tmpdir(), "agentlint-"));
  const artifactPath = join(dir, "agentlint-review.json");
  const result = await ctx.cli.run(["check", "--all", "--base", base, "--review-output", artifactPath]);
  if (result.stdout.trim() !== "") ctx.log.info(result.stdout.trimEnd());
  if (result.stderr.trim() !== "") ctx.log.info(result.stderr.trimEnd());
  if (result.code !== 0 && result.code !== 1) {
    return { gate: "error", code: result.code, findings: [], artifactPath: "" };
  }
  const artifact = await readArtifact(artifactPath);
  return { gate: gateFromExit(result.code), code: result.code, findings: artifact.findings, artifactPath };
}

/**
 * @param {Context} ctx
 * @param {string} headSha
 * @param {Scan} result
 */
async function publishCheckRun(ctx, headSha, result) {
  const annotations = renderAnnotations(result.findings);
  const output = renderCheckOutput(result.gate, result.findings);
  const conclusion = result.gate === "open" ? "success" : result.gate === "closed" ? "failure" : "action_required";
  const created = await ctx.github.write("POST", `/repos/${ctx.repository}/check-runs`, {
    name: "agentlint",
    head_sha: headSha,
    status: "completed",
    conclusion,
    output: { ...output, annotations: annotations.slice(0, ANNOTATION_BATCH) },
  });
  const id = isRecord(created) ? numberField(created["id"]) : null;
  for (let offset = ANNOTATION_BATCH; offset < annotations.length; offset += ANNOTATION_BATCH) {
    await ctx.github.write("PATCH", `/repos/${ctx.repository}/check-runs/${id ?? "dry-run"}`, {
      output: { ...output, annotations: annotations.slice(offset, offset + ANNOTATION_BATCH) },
    });
  }
}

/**
 * @param {Context} ctx
 * @param {number} pullNumber
 * @param {string} body
 */
async function upsertSummary(ctx, pullNumber, body) {
  const comments = await ctx.github.paginate(`/repos/${ctx.repository}/issues/${pullNumber}/comments`);
  const existing = comments.find((comment) => stringField(comment, "body").includes(SUMMARY_MARKER));
  const id = isRecord(existing) ? numberField(existing["id"]) : null;
  if (id !== null) {
    await ctx.github.write("PATCH", `/repos/${ctx.repository}/issues/comments/${id}`, { body });
  } else {
    await ctx.github.write("POST", `/repos/${ctx.repository}/issues/${pullNumber}/comments`, { body });
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
 * @param {Context} ctx
 * @param {number} pullNumber
 * @returns {Promise<Map<number, { threadId: string, resolved: boolean }>>}
 */
async function reviewThreads(ctx, pullNumber) {
  const [owner, name] = ctx.repository.split("/");
  /** @type {Map<number, { threadId: string, resolved: boolean }>} */
  const map = new Map();
  /** @type {string | null} */
  let after = null;
  for (;;) {
    const data = await ctx.github.graphql(THREADS_QUERY, { owner, name, number: pullNumber, after });
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
      map.set(databaseId, { threadId: stringField(node, "id"), resolved: node["isResolved"] === true });
    }
    const pageInfo = threads["pageInfo"];
    if (!isRecord(pageInfo) || pageInfo["hasNextPage"] !== true) return map;
    after = stringField(pageInfo, "endCursor");
  }
}

/**
 * Existing agentlint inline threads on the pull request, keyed by digest.
 *
 * @param {Context} ctx
 * @param {number} pullNumber
 * @returns {Promise<ReviewThread[]>}
 */
async function existingThreads(ctx, pullNumber) {
  const comments = await ctx.github.paginate(`/repos/${ctx.repository}/pulls/${pullNumber}/comments`);
  const threads = await reviewThreads(ctx, pullNumber);
  /** @type {ReviewThread[]} */
  const result = [];
  for (const comment of comments) {
    if (!isRecord(comment) || comment["in_reply_to_id"] !== undefined) continue;
    const digest = digestFromBody(stringField(comment, "body"));
    const commentId = numberField(comment["id"]);
    if (digest === null || commentId === null) continue;
    const thread = threads.get(commentId);
    result.push({ commentId, digest, resolved: thread?.resolved ?? false, threadId: thread?.threadId ?? null });
  }
  return result;
}

/**
 * @param {Context} ctx
 * @param {PullRequest} pull
 * @param {Scan} result
 * @returns {Promise<Set<string>>} digests that have an inline thread after this run
 */
async function publishInline(ctx, pull, result) {
  const files = await ctx.github.paginate(`/repos/${ctx.repository}/pulls/${pull.number}/files`);
  const commentable = commentableByFile(
    files.filter(isRecord).map((file) => ({
      filename: stringField(file, "filename"),
      patch: typeof file["patch"] === "string" ? file["patch"] : undefined,
      status: stringField(file, "status"),
    })),
  );
  const threads = await existingThreads(ctx, pull.number);
  const plan = planReconciliation({ findings: result.findings, threads, commentable });
  ctx.log.info(
    `inline: ${plan.create.length} new, ${plan.resolve.length} to resolve, ${plan.leave.length} unchanged, ${plan.outside.length} outside the diff`,
  );

  if (plan.create.length > 0) {
    await ctx.github.write("POST", `/repos/${ctx.repository}/pulls/${pull.number}/reviews`, {
      commit_id: pull.headSha,
      event: "COMMENT",
      body: renderReviewBody(plan.create.length),
      comments: plan.create.map((finding) => ({
        path: finding.file,
        line: finding.line,
        side: "RIGHT",
        body: renderInlineBody(finding),
      })),
    });
  }
  for (const { thread, reply } of plan.resolve) {
    await ctx.github.write(
      "POST",
      `/repos/${ctx.repository}/pulls/${pull.number}/comments/${thread.commentId}/replies`,
      {
        body: reply,
      },
    );
    if (thread.threadId) await ctx.github.mutate(RESOLVE_MUTATION, { threadId: thread.threadId });
    else ctx.log.warn(`thread for comment ${thread.commentId} has no GraphQL id; left unresolved`);
  }
  return new Set(
    [...plan.leave, ...plan.resolve.map((entry) => entry.thread)]
      .map((thread) => thread.digest)
      .concat(plan.create.map((finding) => finding.digest)),
  );
}

/**
 * Publish a scan for a same-repository pull request: check run, sticky
 * summary, inline comments.
 *
 * @param {Context} ctx
 * @param {PullRequest} pull
 * @param {Scan} result
 */
export async function publish(ctx, pull, result) {
  await publishCheckRun(ctx, pull.headSha, result);
  if (!ctx.inputs.comment) return;
  const inlineDigests = await publishInline(ctx, pull, result);
  await upsertSummary(
    ctx,
    pull.number,
    renderSummary({
      repository: ctx.repository,
      headSha: pull.headSha,
      pullNumber: pull.number,
      gate: result.gate,
      findings: result.findings,
      inlineDigests,
      serverUrl: ctx.serverUrl,
    }),
  );
}

/**
 * @param {Context} ctx
 * @param {Scan} result
 */
export function recordOutputs(ctx, result) {
  const counts = countFindings(result.findings);
  ctx.outputs.set("gate", result.gate);
  ctx.outputs.set("unresolved", String(counts.unresolved));
  ctx.outputs.set("human", String(counts.human));
  ctx.outputs.set("artifact", result.artifactPath);
}

/** @param {Context} ctx @param {PullRequest} pull */
export function isFork(ctx, pull) {
  return pull.headRepo !== "" && pull.headRepo !== ctx.repository;
}

/**
 * @param {Context} ctx
 * @returns {Promise<number>} exit code of the step: the gate code
 */
export async function runGate(ctx) {
  const action = stringField(ctx.event, "action");
  if (!["opened", "synchronize", "reopened", "ready_for_review"].includes(action)) {
    ctx.log.info(`pull_request.${action}: nothing to do`);
    return 0;
  }
  const pull = pullRequestFrom(ctx.event["pull_request"]);
  const headSha = pull.headSha || (await gitOutput(["rev-parse", "HEAD"], ctx.workingDirectory));
  await installIfRequested(ctx);
  const base = await resolveBase(ctx, ctx.inputs.base || pull.baseRef);
  const result = await scan(ctx, base);
  recordOutputs(ctx, result);

  if (isFork(ctx, pull)) {
    ctx.log.info(`fork pull request from ${pull.headRepo}: the token cannot write, printing annotations instead`);
    for (const line of renderWorkflowCommands(result.findings)) ctx.log.info(line);
    return result.code;
  }
  await publish(ctx, { ...pull, headSha }, result);
  return result.code;
}
