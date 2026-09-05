// @ts-check
/**
 * End-to-end runs of `main.mjs` per event, with `fetch` replaced by a recorder
 * and the agentlint CLI replaced by the fixture stub.
 */

import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { exec } from "../src/cli.mjs";
import { run } from "../src/main.mjs";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const stub = join(fixtures, "cli-stub.mjs");
const API = "https://api.github.com";
const REPO = "aurelienbobenrieth/agentlint";
const HUMAN_DIGEST = "dd03e1e41c975157815a150153bd8fb7bb6873cc9357ddfaefaafdfbf1eb5f52";
const AGENT_DIGEST = "103d435f608a96c123f5d168f130495fdd20d00eacb575fb67f87e3849f6376a";

/**
 * @typedef {{ method: string, url: string, body: unknown }} Recorded
 */

/**
 * @param {Partial<Record<string, unknown>>} [overrides] keyed by `METHOD path`
 */
function createFetch(overrides = {}) {
  /** @type {Recorded[]} */
  const requests = [];
  /** @type {Record<string, unknown>} */
  const routes = {
    "GET /repos/aurelienbobenrieth/agentlint/pulls/42/files": JSON.parse(
      readFileSync(join(fixtures, "pulls-files.json"), "utf8"),
    ),
    "GET /repos/aurelienbobenrieth/agentlint/pulls/42": {
      number: 42,
      head: { ref: "feature/gate", sha: "abcdef1234567890abcdef1234567890abcdef12", repo: { full_name: REPO } },
      base: { ref: "main" },
    },
    "GET /repos/aurelienbobenrieth/agentlint/collaborators/aurelienbobenrieth/permission": { permission: "write" },
    "GET /repos/aurelienbobenrieth/agentlint/pulls/comments/8001": {
      id: 8001,
      body: `<!-- agentlint:${HUMAN_DIGEST} -->\n### Dynamic code execution`,
    },
    "POST /repos/aurelienbobenrieth/agentlint/check-runs": { id: 77 },
    "POST /graphql": {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          },
        },
      },
    },
    ...overrides,
  };
  /** @type {typeof fetch} */
  const fetchImpl = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const path = url.replace(API, "").replace(/\?.*$/, "");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ method, url: path, body });
    const key = `${method} ${path}`;
    const found = key in routes ? routes[key] : method === "GET" ? [] : {};
    return new Response(JSON.stringify(found), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { requests, fetchImpl };
}

/** @type {string[]} */
const cleanup = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** @param {string[]} args @param {string} cwd */
async function g(args, cwd) {
  const result = await exec(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "seed",
      GIT_AUTHOR_EMAIL: "seed@example.com",
      GIT_COMMITTER_NAME: "seed",
      GIT_COMMITTER_EMAIL: "seed@example.com",
    },
  });
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * The JSON body of a recorded request, as a plain object.
 *
 * @param {Recorded | undefined} request
 * @returns {Record<string, unknown>}
 */
function bodyOf(request) {
  if (!request || typeof request.body !== "object" || request.body === null) throw new Error("request has no body");
  return /** @type {Record<string, unknown>} */ (request.body);
}

/**
 * Walk a JSON value by keys and indexes.
 *
 * @param {unknown} value
 * @param {...(string | number)} path
 * @returns {unknown}
 */
function at(value, ...path) {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === "number") current = current[key];
    else if (typeof current === "object" && current !== null && typeof key === "string")
      current = /** @type {Record<string, unknown>} */ (current)[key];
    else throw new Error(`no ${String(key)} in ${JSON.stringify(current)}`);
  }
  return current;
}

/**
 * A working checkout with an `origin` bare remote and a pushed `feature/gate` branch.
 */
async function createRepo() {
  const root = await mkdtemp(join(tmpdir(), "agentlint-action-"));
  cleanup.push(root);
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  await g(["init", "--bare", "-b", "main", origin], root);
  await g(["clone", "-q", origin, work], root);
  await writeFile(join(work, "README.md"), "seed\n");
  await g(["add", "."], work);
  await g(["commit", "-q", "-m", "seed"], work);
  await g(["push", "-q", "origin", "HEAD:main"], work);
  await g(["checkout", "-q", "-b", "feature/gate"], work);
  await writeFile(join(work, "feature.txt"), "feature\n");
  await g(["add", "."], work);
  await g(["commit", "-q", "-m", "feature"], work);
  await g(["push", "-q", "origin", "feature/gate"], work);
  await g(["checkout", "-q", "main"], work);
  return { root, origin, work, git: g };
}

/**
 * @param {string} event
 * @param {string} fixture
 * @param {Record<string, string>} extra
 */
async function runAction(event, fixture, extra) {
  const outputDir = await mkdtemp(join(tmpdir(), "agentlint-out-"));
  cleanup.push(outputDir);
  const outputFile = join(outputDir, "output");
  const stubLog = join(outputDir, "stub.log");
  await writeFile(outputFile, "");
  const { requests, fetchImpl } = createFetch();
  /** @type {string[]} */
  const logs = [];
  const result = await run({
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: event,
      GITHUB_EVENT_PATH: join(fixtures, fixture),
      GITHUB_REPOSITORY: REPO,
      GITHUB_API_URL: API,
      GITHUB_GRAPHQL_URL: `${API}/graphql`,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: outputDir,
      AGENTLINT_ACTION_CLI_STUB: stub,
      AGENTLINT_STUB_LOG: stubLog,
      INPUT_VERSION: "0.1.5",
      "INPUT_GITHUB-TOKEN": "token",
      INPUT_COMMENT: "true",
      "INPUT_DRY-RUN": "false",
      INPUT_BASE: "main",
      ...extra,
    },
    fetchImpl,
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(`W ${m}`), error: (m) => logs.push(`E ${m}`) },
  });
  const stubCalls = await readFile(stubLog, "utf8")
    .then((text) =>
      text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    )
    .catch(() => []);
  return { ...result, requests, logs, outputFile: await readFile(outputFile, "utf8"), stubCalls };
}

describe("pull_request", () => {
  it("publishes the check run, the inline review, and the sticky summary on a same-repo PR", async () => {
    const repo = await createRepo();
    const { exitCode, outputs, requests, outputFile } = await runAction("pull_request", "pull_request.opened.json", {
      GITHUB_WORKSPACE: repo.work,
      "INPUT_WORKING-DIRECTORY": ".",
    });
    expect(exitCode).toBe(1);
    expect(outputs.get("gate")).toBe("closed");
    expect(outputs.get("unresolved")).toBe("3");
    expect(outputs.get("human")).toBe("2");
    expect(outputs.get("artifact")).toMatch(/agentlint-review\.json$/);
    expect(outputFile).toContain("gate<<");

    const checkRun = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/check-runs`);
    expect(checkRun?.body).toMatchObject({
      name: "agentlint",
      head_sha: "abcdef1234567890abcdef1234567890abcdef12",
      conclusion: "failure",
    });
    expect(at(bodyOf(checkRun), "output", "annotations")).toHaveLength(3);

    const review = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/pulls/42/reviews`);
    expect(bodyOf(review)).toMatchObject({
      event: "COMMENT",
      comments: [
        { path: "src/vendor/legacy-parser.js", line: 3, side: "RIGHT" },
        { path: "src/payments/capture-order.ts", line: 6, side: "RIGHT" },
      ],
    });
    expect(at(bodyOf(review), "comments")).toHaveLength(2);
    expect(at(bodyOf(review), "comments", 0, "body")).toMatch(new RegExp(`^<!-- agentlint:${HUMAN_DIGEST} -->`));

    const summary = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/issues/42/comments`);
    expect(bodyOf(summary)["body"]).toContain("<!-- agentlint:summary -->");
    expect(bodyOf(summary)["body"]).toContain("2026-07-drop-legacy-users.ts:4");
  });

  it("edits the existing summary, leaves existing threads, and resolves stale ones", async () => {
    const repo = await createRepo();
    const { requests, fetchImpl } = createFetch({
      "GET /repos/aurelienbobenrieth/agentlint/issues/42/comments": [
        { id: 500, body: "<!-- agentlint:summary -->\nold" },
      ],
      "GET /repos/aurelienbobenrieth/agentlint/pulls/42/comments": [
        { id: 8001, body: `<!-- agentlint:${HUMAN_DIGEST} -->\nx` },
        { id: 8002, body: `<!-- agentlint:${"e".repeat(64)} -->\ngone` },
        { id: 8003, in_reply_to_id: 8002, body: "a reply" },
        { id: 8004, body: `<!-- agentlint:${"0".repeat(64)} -->\nalready resolved` },
      ],
      "POST /graphql": {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  { id: "T_1", isResolved: false, comments: { nodes: [{ databaseId: 8001 }] } },
                  { id: "T_2", isResolved: false, comments: { nodes: [{ databaseId: 8002 }] } },
                  { id: "T_3", isResolved: true, comments: { nodes: [{ databaseId: 8004 }] } },
                ],
              },
            },
          },
        },
      },
    });
    const result = await run({
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: join(fixtures, "pull_request.opened.json"),
        GITHUB_REPOSITORY: REPO,
        GITHUB_WORKSPACE: repo.work,
        RUNNER_TEMP: repo.root,
        AGENTLINT_ACTION_CLI_STUB: stub,
        INPUT_BASE: "main",
        "INPUT_GITHUB-TOKEN": "token",
      },
      fetchImpl,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(result.exitCode).toBe(1);
    const writes = requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`);
    expect(writes).toContain(`PATCH /repos/${REPO}/issues/comments/500`);
    expect(writes).toContain(`POST /repos/${REPO}/pulls/42/comments/8002/replies`);
    expect(writes).not.toContain(`POST /repos/${REPO}/pulls/42/comments/8004/replies`);
    const review = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/pulls/42/reviews`);
    expect(at(bodyOf(review), "comments")).toHaveLength(1);
    expect(at(bodyOf(review), "comments", 0, "body")).toMatch(new RegExp(`^<!-- agentlint:${AGENT_DIGEST} -->`));
    const mutations = requests.filter((r) => r.url === "/graphql" && String(bodyOf(r)["query"]).includes("mutation"));
    expect(mutations).toHaveLength(1);
    expect(at(bodyOf(mutations[0]), "variables", "threadId")).toBe("T_2");
  });

  it("prints workflow commands and writes nothing on a fork PR", async () => {
    const repo = await createRepo();
    const { exitCode, outputs, requests, logs } = await runAction(
      "pull_request",
      "pull_request.synchronize.fork.json",
      {
        GITHUB_WORKSPACE: repo.work,
      },
    );
    expect(exitCode).toBe(1);
    expect(outputs.get("gate")).toBe("closed");
    expect(outputs.get("artifact")).not.toBe("");
    expect(requests).toEqual([]);
    expect(logs.some((line) => line.startsWith("::error file=src/vendor/legacy-parser.js,line=3"))).toBe(true);
  });

  it("records the plan instead of writing in dry-run", async () => {
    const repo = await createRepo();
    const { exitCode, outputs, requests } = await runAction("pull_request", "pull_request.opened.json", {
      GITHUB_WORKSPACE: repo.work,
      "INPUT_DRY-RUN": "true",
    });
    expect(exitCode).toBe(1);
    expect(requests.every((r) => r.method === "GET" || r.url === "/graphql")).toBe(true);
    const plan = JSON.parse(outputs.get("dry-run-plan") ?? "[]");
    expect(
      plan.map((/** @type {unknown} */ entry) => `${String(at(entry, "method"))} ${String(at(entry, "url"))}`),
    ).toEqual([
      `POST ${API}/repos/${REPO}/check-runs`,
      `POST ${API}/repos/${REPO}/pulls/42/reviews`,
      `POST ${API}/repos/${REPO}/issues/42/comments`,
    ]);
  });
});

describe("issue_comment", () => {
  it("approves, commits as the user, pushes, re-scans, and reacts", async () => {
    const repo = await createRepo();
    const { exitCode, requests, stubCalls } = await runAction("issue_comment", "issue_comment.created.approve.json", {
      GITHUB_WORKSPACE: repo.work,
    });
    expect(exitCode).toBe(0);
    const approveCall = stubCalls.find((call) => call.args[0] === "approve");
    expect(approveCall).toEqual({
      args: [
        "approve",
        "dd03e1e41c97",
        "--reason",
        "Vendored parser; the trust boundary is the formula allowlist in the caller",
        "--base",
        "origin/main",
      ],
      actor: "human:aurelienbobenrieth",
    });

    const log = await repo.git(["log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%B", "feature/gate"], repo.origin);
    expect(log).toContain("aurelienbobenrieth <1001+aurelienbobenrieth@users.noreply.github.com>");
    expect(log).toContain("github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>");
    expect(log).toContain("chore(agentlint): accept security/dynamic-code-execution at src/vendor/legacy-parser.js:3");
    expect(log).toContain("Approved-by: @aurelienbobenrieth");
    const newHead = await repo.git(["rev-parse", "feature/gate"], repo.origin);

    const checkRun = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/check-runs`);
    expect(bodyOf(checkRun)["head_sha"]).toBe(newHead);
    expect(requests.some((r) => r.url === `/repos/${REPO}/issues/comments/9001/reactions`)).toBe(true);
    expect(requests.find((r) => r.url === `/repos/${REPO}/issues/comments/9001/reactions`)?.body).toEqual({
      content: "rocket",
    });
  });

  it("refuses users without write access with a thumbs down", async () => {
    const repo = await createRepo();
    const { requests, fetchImpl } = createFetch({
      "GET /repos/aurelienbobenrieth/agentlint/collaborators/aurelienbobenrieth/permission": { permission: "read" },
    });
    const result = await run({
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "issue_comment",
        GITHUB_EVENT_PATH: join(fixtures, "issue_comment.created.approve.json"),
        GITHUB_REPOSITORY: REPO,
        GITHUB_WORKSPACE: repo.work,
        AGENTLINT_ACTION_CLI_STUB: stub,
        "INPUT_GITHUB-TOKEN": "token",
      },
      fetchImpl,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(result.exitCode).toBe(0);
    const writes = requests.filter((r) => r.method !== "GET");
    expect(writes.map((r) => r.url)).toEqual([
      `/repos/${REPO}/issues/comments/9001/reactions`,
      `/repos/${REPO}/issues/42/comments`,
    ]);
    expect(writes[0]?.body).toEqual({ content: "-1" });
    expect(bodyOf(writes[1])["body"]).toContain("write access");
  });

  it("replies with the CLI message when the approval fails and pushes nothing", async () => {
    const repo = await createRepo();
    const eventDir = await mkdtemp(join(tmpdir(), "agentlint-ev-"));
    cleanup.push(eventDir);
    const original = JSON.parse(await readFile(join(fixtures, "issue_comment.created.approve.json"), "utf8"));
    original.comment.body = '/agentlint approve deadbeef0 --reason "nope"';
    const eventPath = join(eventDir, "event.json");
    await writeFile(eventPath, JSON.stringify(original));
    const before = await repo.git(["rev-parse", "feature/gate"], repo.origin);
    const { requests, fetchImpl } = createFetch();
    await run({
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "issue_comment",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: REPO,
        GITHUB_WORKSPACE: repo.work,
        AGENTLINT_ACTION_CLI_STUB: stub,
        INPUT_BASE: "main",
        "INPUT_GITHUB-TOKEN": "token",
      },
      fetchImpl,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(await repo.git(["rev-parse", "feature/gate"], repo.origin)).toBe(before);
    const reply = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/issues/42/comments`);
    expect(bodyOf(reply)["body"]).toContain("No current finding matches");
  });
});

describe("pull_request_review_comment", () => {
  it("takes the selector from the parent comment marker and replies in the thread", async () => {
    const repo = await createRepo();
    const { exitCode, requests, stubCalls } = await runAction(
      "pull_request_review_comment",
      "pull_request_review_comment.created.json",
      { GITHUB_WORKSPACE: repo.work, "INPUT_DRY-RUN": "true" },
    );
    expect(exitCode).toBe(0);
    expect(requests.some((r) => r.url === `/repos/${REPO}/pulls/comments/8001`)).toBe(true);
    const approveCall = stubCalls.find((call) => call.args[0] === "approve");
    expect(approveCall?.args.slice(0, 4)).toEqual([
      "approve",
      HUMAN_DIGEST,
      "--reason",
      "The formula surface is fixed by the customer allowlist upstream",
    ]);
    // dry-run: nothing was sent, the push and the reaction are in the plan
    expect(requests.every((r) => r.method === "GET" || r.url === "/graphql")).toBe(true);
  });
});

describe("workflow trust boundary", () => {
  it("rejects pull_request_target before executing repository code or calling GitHub", async () => {
    const result = await runAction("pull_request_target", "pull_request.opened.json", {});
    expect(result.exitCode).toBe(2);
    expect(result.stubCalls).toEqual([]);
    expect(result.requests).toEqual([]);
    expect(result.logs.join("\n")).toContain("pull_request_target is unsupported");
  });
});
