// @ts-check
/**
 * End-to-end runs of `main.mjs` per event, with `fetch` replaced by a recorder and the agentlint CLI replaced by the
 * fixture stub.
 */

import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { exec } from "../src/cli.mjs";
import { run } from "../src/main.mjs";

const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const stub = join(fixtures, "cli-stub.mjs");
const API = "https://api.github.com";
const REPO = "aurelienbobenrieth/agentlint";
const BOT = { login: "github-actions[bot]", id: 41898282, type: "Bot" };
const HUMAN_DIGEST = "dd03e1e41c975157815a150153bd8fb7bb6873cc9357ddfaefaafdfbf1eb5f52";
const AGENT_DIGEST = "103d435f608a96c123f5d168f130495fdd20d00eacb575fb67f87e3849f6376a";

/**
 * @typedef {{ method: string; url: string; body: unknown }} Recorded
 */

/**
 * @param {Partial<Record<string, unknown>>} [overrides] Keyed by `METHOD path`
 */
function createFetch(overrides = {}) {
  /**
   * @type {Recorded[]}
   */
  const requests = [];
  /**
   * @type {Record<string, unknown>}
   */
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
      user: BOT,
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
  /**
   * @type {typeof fetch}
   */
  const fetchImpl = async (...args) => {
    const [input, init] = args;
    const url = Schema.is(Schema.String)(input) ? input : "url" in input ? input.url : input.href;
    const method = init?.method ?? "GET";
    const path = url.replace(API, "").replace(/\?.*$/, "");
    const body = Schema.is(Schema.String)(init?.body) ? JSON.parse(init.body) : undefined;
    requests.push({ method, url: path, body });
    const key = `${method} ${path}`;
    const found = key in routes ? routes[key] : method === "GET" ? [] : {};
    return new Response(JSON.stringify(found), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { requests, fetchImpl };
}

/**
 * @type {string[]}
 */
const cleanup = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * @param {object} input
 * @param {string[]} input.args
 * @param {string} input.cwd
 */
async function g({ args, cwd }) {
  const result = await exec({
    argv: ["git", ...args],
    options: {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "seed",
        GIT_AUTHOR_EMAIL: "seed@example.com",
        GIT_COMMITTER_NAME: "seed",
        GIT_COMMITTER_EMAIL: "seed@example.com",
      },
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
  if (!request || !Schema.is(Schema.Record(Schema.String, Schema.Unknown))(request.body)) {
    throw new Error("request has no object body");
  }
  return Object.fromEntries(Object.entries(request.body));
}

/**
 * Walk a JSON value by keys and indexes.
 *
 * @param {object} input
 * @param {unknown} input.value
 * @param {...(string | number)} input.path
 * @returns {unknown}
 */
function at({ value, path }) {
  return path.reduce((current, key) => {
    if (Array.isArray(current) && Schema.is(Schema.Number)(key)) current = current[key];
    else if (Schema.is(Schema.Record(Schema.String, Schema.Unknown))(current) && Schema.is(Schema.String)(key))
      current = current[key];
    else throw new Error(`no ${String(key)} in ${JSON.stringify(current)}`);
    return current;
  }, value);
}

/**
 * @param {string} path
 */
const jsonLines = (path) =>
  readFile(path, "utf8")
    .then((text) =>
      text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    )
    .catch(() => []);

/**
 * A working checkout with an `origin` bare remote and a pushed `feature/gate` branch.
 */
async function createRepo() {
  const root = await mkdtemp(join(tmpdir(), "agentlint-action-"));
  cleanup.push(root);
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  await g({ args: ["init", "--bare", "-b", "main", origin], cwd: root });
  await g({ args: ["clone", "-q", origin, work], cwd: root });
  await writeFile(join(work, "README.md"), "seed\n");
  await g({ args: ["add", "."], cwd: work });
  await g({ args: ["commit", "-q", "-m", "seed"], cwd: work });
  await g({ args: ["push", "-q", "origin", "HEAD:main"], cwd: work });
  await g({ args: ["checkout", "-q", "-b", "feature/gate"], cwd: work });
  await writeFile(join(work, "feature.txt"), "feature\n");
  await g({ args: ["add", "."], cwd: work });
  await g({ args: ["commit", "-q", "-m", "feature"], cwd: work });
  await g({ args: ["push", "-q", "origin", "feature/gate"], cwd: work });
  await g({ args: ["checkout", "-q", "main"], cwd: work });
  return { root, origin, work, git: g };
}

/**
 * @param {object} input
 * @param {string} input.event
 * @param {string} input.fixture
 * @param {Record<string, string>} input.extra
 * @param {Partial<Record<string, unknown>>} [input.routes]
 */
async function runAction({ event, fixture, extra, routes = {} }) {
  const outputDir = await mkdtemp(join(tmpdir(), "agentlint-out-"));
  cleanup.push(outputDir);
  const outputFile = join(outputDir, "output");
  const stubLog = join(outputDir, "stub.log");
  const stubEnvLog = join(outputDir, "stub-env.log");
  const installEnvLog = join(outputDir, "install-env.log");
  await writeFile(outputFile, "");
  const { requests, fetchImpl } = createFetch(routes);
  /**
   * @type {string[]}
   */
  const logs = [];
  const result = await run({
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: event,
      GITHUB_EVENT_PATH: isAbsolute(fixture) ? fixture : join(fixtures, fixture),
      GITHUB_REPOSITORY: REPO,
      GITHUB_API_URL: API,
      GITHUB_GRAPHQL_URL: `${API}/graphql`,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: outputDir,
      AGENTLINT_ACTION_CLI_STUB: stub,
      AGENTLINT_STUB_LOG: stubLog,
      AGENTLINT_STUB_ENV_LOG: stubEnvLog,
      AGENTLINT_INSTALL_ENV_LOG: installEnvLog,
      GITHUB_STEP_SUMMARY: join(outputDir, "summary.md"),
      // What a runner or a careless workflow can put in the step environment.
      GITHUB_TOKEN: "leak",
      GH_TOKEN: "leak",
      ACTIONS_RUNTIME_TOKEN: "leak",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "leak",
      NODE_AUTH_TOKEN: "leak",
      NPM_TOKEN: "leak",
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
  return {
    ...result,
    requests,
    logs,
    outputFile: await readFile(outputFile, "utf8"),
    stepSummary: await readFile(join(outputDir, "summary.md"), "utf8").catch(() => ""),
    stubCalls: await jsonLines(stubLog),
    /**
     * @type {string[][]} names of the environment variables each CLI invocation received
     */
    stubEnvs: await jsonLines(stubEnvLog),
    /**
     * @type {string[][]} same for the install lifecycle script
     */
    installEnvs: await jsonLines(installEnvLog),
  };
}

describe("pull_request", () => {
  it("fails closed when GitHub repeats a GraphQL review cursor", async () => {
    const repo = await createRepo();
    const result = await runAction({
      event: "pull_request",
      fixture: "pull_request.opened.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
        "INPUT_WORKING-DIRECTORY": ".",
      },
      routes: {
        "POST /graphql": {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: true, endCursor: "same" },
                },
              },
            },
          },
        },
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.logs.some((line) => line.includes("invalid cursor"))).toBe(true);
    expect(result.requests.filter((request) => request.url === "/graphql")).toHaveLength(2);
  });
  it("publishes the check run, the inline review, and the sticky summary on a same-repo PR", async () => {
    const repo = await createRepo();
    const { exitCode, outputs, requests, outputFile } = await runAction({
      event: "pull_request",
      fixture: "pull_request.opened.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
        "INPUT_WORKING-DIRECTORY": ".",
      },
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
    expect(at({ value: bodyOf(checkRun), path: ["output", "annotations"] })).toHaveLength(3);

    const review = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/pulls/42/reviews`);
    expect(bodyOf(review)).toMatchObject({
      event: "COMMENT",
      comments: [
        { path: "src/vendor/legacy-parser.js", line: 3, side: "RIGHT" },
        { path: "src/payments/capture-order.ts", line: 6, side: "RIGHT" },
      ],
    });
    expect(at({ value: bodyOf(review), path: ["comments"] })).toHaveLength(2);
    expect(at({ value: bodyOf(review), path: ["comments", 0, "body"] })).toMatch(
      new RegExp(`^<!-- agentlint:${HUMAN_DIGEST} -->`),
    );

    const summary = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/issues/42/comments`);
    expect(bodyOf(summary)["body"]).toContain("<!-- agentlint:summary -->");
    expect(bodyOf(summary)["body"]).toContain("2026-07-drop-legacy-users.ts:4");
  });

  it("edits the existing summary, leaves existing threads, and resolves stale ones", async () => {
    const repo = await createRepo();
    const { requests, fetchImpl } = createFetch({
      "GET /repos/aurelienbobenrieth/agentlint/issues/42/comments": [
        { id: 500, user: BOT, body: "<!-- agentlint:summary -->\nold" },
      ],
      "GET /repos/aurelienbobenrieth/agentlint/pulls/42/comments": [
        { id: 8001, user: BOT, body: `<!-- agentlint:${HUMAN_DIGEST} -->\nx` },
        { id: 8002, user: BOT, body: `<!-- agentlint:${"e".repeat(64)} -->\ngone` },
        { id: 8003, in_reply_to_id: 8002, body: "a reply" },
        { id: 8004, user: BOT, body: `<!-- agentlint:${"0".repeat(64)} -->\nalready resolved` },
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
    expect(at({ value: bodyOf(review), path: ["comments"] })).toHaveLength(1);
    expect(at({ value: bodyOf(review), path: ["comments", 0, "body"] })).toMatch(
      new RegExp(`^<!-- agentlint:${AGENT_DIGEST} -->`),
    );
    const mutations = requests.filter((r) => r.url === "/graphql" && String(bodyOf(r)["query"]).includes("mutation"));
    expect(mutations).toHaveLength(1);
    expect(at({ value: bodyOf(mutations[0]), path: ["variables", "threadId"] })).toBe("T_2");
  });

  it("prints workflow commands and writes nothing on a fork PR", async () => {
    const repo = await createRepo();
    const { exitCode, outputs, requests, logs, stepSummary } = await runAction({
      event: "pull_request",
      fixture: "pull_request.synchronize.fork.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
      },
    });
    expect(exitCode).toBe(1);
    expect(outputs.get("gate")).toBe("closed");
    expect(outputs.get("artifact")).not.toBe("");
    expect(requests).toEqual([]);
    expect(logs.some((line) => line.startsWith("::error file=src/vendor/legacy-parser.js,line=3"))).toBe(true);
    expect(logs.some((line) => line.includes("not a trustworthy gate"))).toBe(true);
    expect(stepSummary).toContain("not a trustworthy gate");
  });

  it("records the plan instead of writing in dry-run", async () => {
    const repo = await createRepo();
    const { exitCode, outputs, requests } = await runAction({
      event: "pull_request",
      fixture: "pull_request.opened.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
        "INPUT_DRY-RUN": "true",
      },
    });
    expect(exitCode).toBe(1);
    expect(requests.every((r) => r.method === "GET" || r.url === "/graphql")).toBe(true);
    const plan = JSON.parse(outputs.get("dry-run-plan") ?? "[]");
    expect(
      plan.map(
        (
          /**
           * @type {unknown}
           */ entry,
        ) => `${String(at({ value: entry, path: ["method"] }))} ${String(at({ value: entry, path: ["url"] }))}`,
      ),
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
    const { exitCode, requests, stubCalls } = await runAction({
      event: "issue_comment",
      fixture: "issue_comment.created.approve.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
      },
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

    const log = await repo.git({
      args: ["log", "-1", "--format=%an <%ae>%n%cn <%ce>%n%B", "feature/gate"],
      cwd: repo.origin,
    });
    expect(log).toContain("aurelienbobenrieth <1001+aurelienbobenrieth@users.noreply.github.com>");
    expect(log).toContain("github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>");
    expect(log).toContain("chore(agentlint): accept security/dynamic-code-execution at src/vendor/legacy-parser.js:3");
    expect(log).toContain("Approved-by: @aurelienbobenrieth");
    const newHead = await repo.git({ args: ["rev-parse", "feature/gate"], cwd: repo.origin });

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
    const before = await repo.git({ args: ["rev-parse", "feature/gate"], cwd: repo.origin });
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
    expect(await repo.git({ args: ["rev-parse", "feature/gate"], cwd: repo.origin })).toBe(before);
    const reply = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/issues/42/comments`);
    expect(bodyOf(reply)["body"]).toContain("No current finding matches");
  });
});

describe("pull_request_review_comment", () => {
  it("takes the selector from the parent comment marker and reacts on the review comment", async () => {
    const repo = await createRepo();
    const { exitCode, outputs, requests, stubCalls } = await runAction({
      event: "pull_request_review_comment",
      fixture: "pull_request_review_comment.created.json",
      extra: { GITHUB_WORKSPACE: repo.work, "INPUT_DRY-RUN": "true" },
    });
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
    const plan = JSON.parse(outputs.get("dry-run-plan") ?? "[]").map(
      (
        /**
         * @type {unknown}
         */ entry,
      ) => `${String(at({ value: entry, path: ["method"] }))} ${String(at({ value: entry, path: ["url"] }))}`,
    );
    expect(plan).toEqual([
      "GIT git push origin HEAD:refs/heads/feature/gate",
      `POST ${API}/repos/${REPO}/check-runs`,
      `POST ${API}/repos/${REPO}/pulls/42/reviews`,
      `POST ${API}/repos/${REPO}/issues/42/comments`,
      `POST ${API}/repos/${REPO}/pulls/comments/9002/reactions`,
    ]);
  });
});

describe("workflow trust boundary", () => {
  it("ignores a marker in a comment that the action did not post", async () => {
    const repo = await createRepo();
    const { exitCode, outputs, stubCalls } = await runAction({
      event: "pull_request_review_comment",
      fixture: "pull_request_review_comment.created.json",
      extra: { GITHUB_WORKSPACE: repo.work, "INPUT_DRY-RUN": "true" },
      routes: {
        [`GET /repos/${REPO}/pulls/comments/8001`]: {
          id: 8001,
          user: { login: "outside-contributor", id: 2002, type: "User" },
          body: `<!-- agentlint:${HUMAN_DIGEST} -->
### Dynamic code execution`,
        },
      },
    });
    expect(exitCode).toBe(0);
    expect(stubCalls.filter((call) => call.args[0] === "approve")).toEqual([]);
    const plan = JSON.parse(outputs.get("dry-run-plan") ?? "[]");
    expect(
      plan.map(
        (
          /**
           * @type {unknown}
           */ entry,
        ) => String(at({ value: entry, path: ["url"] })),
      ),
    ).toEqual([`${API}/repos/${REPO}/pulls/42/comments/9002/replies`]);
  });

  it("rejects pull_request_target before executing repository code or calling GitHub", async () => {
    const result = await runAction({ event: "pull_request_target", fixture: "pull_request.opened.json", extra: {} });
    expect(result.exitCode).toBe(2);
    expect(result.stubCalls).toEqual([]);
    expect(result.requests).toEqual([]);
    expect(result.logs.join("\n")).toContain("pull_request_target is unsupported");
  });
});

/**
 * The credentials `runAction` plants in the step environment, plus every action input.
 */
const PLANTED = new Set([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
]);

/**
 * @param {string} name
 */
const bearsCredential = (name) => /^INPUT_/i.test(name) || PLANTED.has(name.toUpperCase());

/**
 * An event file with another comment body.
 *
 * @param {string} body
 */
async function commentEvent(body) {
  const dir = await mkdtemp(join(tmpdir(), "agentlint-ev-"));
  cleanup.push(dir);
  const event = JSON.parse(await readFile(join(fixtures, "issue_comment.created.approve.json"), "utf8"));
  event.comment.body = body;
  await writeFile(join(dir, "event.json"), JSON.stringify(event));
  return join(dir, "event.json");
}

describe("least privilege", () => {
  it("hands no token to the install lifecycle scripts or to the CLI", { timeout: 120_000 }, async () => {
    const repo = await createRepo();
    // `npm ci` with no dependencies is offline. The lifecycle script is the repository code under test.
    await writeFile(
      join(repo.work, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        private: true,
        scripts: { preinstall: "node dump-env.mjs" },
      }),
    );
    await writeFile(
      join(repo.work, "package-lock.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "fixture", version: "1.0.0" } },
      }),
    );
    await writeFile(join(repo.work, ".npmrc"), ["audit=false", "fund=false", "update-notifier=false", ""].join("\n"));
    await writeFile(
      join(repo.work, "dump-env.mjs"),
      'import { appendFileSync } from "node:fs";\n' +
        'appendFileSync(process.env["AGENTLINT_INSTALL_ENV_LOG"], JSON.stringify(Object.keys(process.env)) + "\\n");\n',
    );
    const { exitCode, stubEnvs, installEnvs, logs } = await runAction({
      event: "pull_request",
      fixture: "pull_request.opened.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
        INPUT_INSTALL: "true",
      },
    });
    expect(logs.filter((line) => line.startsWith("E "))).toEqual([]);
    expect(exitCode).toBe(1);
    expect(installEnvs).toHaveLength(1);
    expect(stubEnvs.length).toBeGreaterThan(0);
    for (const names of [...installEnvs, ...stubEnvs]) {
      expect(names.filter(bearsCredential)).toEqual([]);
      expect(names).toContain("AGENTLINT_STUB_LOG");
    }
  });

  it("pushes with the input token without writing it to the repository configuration", async () => {
    const repo = await createRepo();
    const { exitCode } = await runAction({
      event: "issue_comment",
      fixture: "issue_comment.created.approve.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
        "INPUT_GITHUB-TOKEN": "ghs_secret_token_value",
      },
    });
    expect(exitCode).toBe(0);
    const config = await readFile(join(repo.work, ".git", "config"), "utf8");
    expect(config).not.toContain("extraheader");
    expect(config).not.toContain(Buffer.from("x-access-token:ghs_secret_token_value").toString("base64"));
  });
});

describe("approval push", () => {
  it("applies the approval again when the branch moved, without a forced push", async () => {
    const repo = await createRepo();
    const other = join(repo.root, "other");
    await repo.git({ args: ["clone", "-q", "-b", "feature/gate", repo.origin, other], cwd: repo.root });
    await writeFile(join(other, "concurrent.txt"), "another approval or a new commit\n");
    await repo.git({ args: ["add", "."], cwd: other });
    await repo.git({ args: ["commit", "-q", "-m", "concurrent"], cwd: other });

    const { exitCode, stubCalls, logs } = await runAction({
      event: "issue_comment",
      fixture: "issue_comment.created.approve.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
        AGENTLINT_STUB_RACE: other,
      },
    });
    expect(logs.filter((line) => line.startsWith("E "))).toEqual([]);
    expect(exitCode).toBe(0);
    expect(stubCalls.filter((call) => call.args[0] === "approve")).toHaveLength(2);
    const subjects = await repo.git({ args: ["log", "-3", "--format=%s", "feature/gate"], cwd: repo.origin });
    expect(subjects.split("\n")).toEqual([
      "chore(agentlint): accept security/dynamic-code-execution at src/vendor/legacy-parser.js:3",
      "concurrent",
      "feature",
    ]);
  });

  it("replies and fails the run when the remote refuses the push", async () => {
    const repo = await createRepo();
    const hook = join(repo.origin, "hooks", "pre-receive");
    await writeFile(hook, "#!/bin/sh\necho 'protected branch: push declined' >&2\nexit 1\n", { mode: 0o755 });
    const before = await repo.git({ args: ["rev-parse", "feature/gate"], cwd: repo.origin });
    const { exitCode, requests } = await runAction({
      event: "issue_comment",
      fixture: "issue_comment.created.approve.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
      },
    });
    expect(exitCode).toBe(1);
    expect(await repo.git({ args: ["rev-parse", "feature/gate"], cwd: repo.origin })).toBe(before);
    const writes = requests.filter((r) => r.method !== "GET" && r.url !== "/graphql");
    expect(writes.map((r) => r.url)).toEqual([`/repos/${REPO}/issues/42/comments`]);
    expect(bodyOf(writes[0])["body"]).toContain("could not push it to `feature/gate`");
    expect(bodyOf(writes[0])["body"]).toContain("push declined");
  });
});

describe("path:line approvals", () => {
  it("refuses when the head is not the one the latest summary was rendered for", async () => {
    const repo = await createRepo();
    const event = await commentEvent('/agentlint approve src/vendor/legacy-parser.js:3 --reason "reviewed"');
    const { exitCode, requests, stubCalls } = await runAction({
      event: "issue_comment",
      fixture: event,
      extra: { GITHUB_WORKSPACE: repo.work },
      routes: {
        [`GET /repos/${REPO}/issues/42/comments`]: [
          {
            id: 500,
            user: BOT,
            body: `<!-- agentlint:summary -->\n<!-- agentlint:head:${"1".repeat(40)} -->\n## agentlint: gate closed`,
          },
        ],
      },
    });
    expect(exitCode).toBe(0);
    expect(stubCalls).toEqual([]);
    const reply = requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/issues/42/comments`);
    expect(bodyOf(reply)["body"]).toContain("was not approved");
    expect(bodyOf(reply)["body"]).toContain("the latest agentlint summary is for `1111111`");
    expect(bodyOf(reply)["body"]).toContain("approve by digest");
  });

  it("ignores a summary that another account posted, and accepts the action's own for the same head", async () => {
    const repo = await createRepo();
    const head = await repo.git({ args: ["rev-parse", "feature/gate"], cwd: repo.origin });
    const event = await commentEvent('/agentlint approve src/vendor/legacy-parser.js:3 --reason "reviewed"');
    const summary = `<!-- agentlint:summary -->\n<!-- agentlint:head:${head} -->\n## agentlint: gate closed`;

    const foreign = await runAction({
      event: "issue_comment",
      fixture: event,
      extra: { GITHUB_WORKSPACE: repo.work },
      routes: {
        [`GET /repos/${REPO}/issues/42/comments`]: [
          { id: 500, user: { login: "other-app[bot]", id: 7, type: "Bot" }, body: summary },
        ],
      },
    });
    expect(foreign.stubCalls).toEqual([]);
    const refusal = foreign.requests.find((r) => r.method === "POST" && r.url === `/repos/${REPO}/issues/42/comments`);
    expect(bodyOf(refusal)["body"]).toContain("there is no agentlint summary");

    const own = await runAction({
      event: "issue_comment",
      fixture: event,
      extra: { GITHUB_WORKSPACE: repo.work },
      routes: { [`GET /repos/${REPO}/issues/42/comments`]: [{ id: 500, user: BOT, body: summary }] },
    });
    expect(own.exitCode).toBe(0);
    expect(own.stubCalls.find((call) => call.args[0] === "approve")?.args[1]).toBe("src/vendor/legacy-parser.js:3");
    expect(own.requests.some((r) => r.method === "PATCH" && r.url === `/repos/${REPO}/issues/comments/500`)).toBe(true);
  });
});

describe("comment identity", () => {
  it("resolves the token's own account and edits only its summary", async () => {
    const repo = await createRepo();
    const { requests } = await runAction({
      event: "pull_request",
      fixture: "pull_request.opened.json",
      extra: { GITHUB_WORKSPACE: repo.work },
      routes: {
        "POST /graphql": {
          data: {
            viewer: { login: "my-gate-app[bot]" },
            repository: {
              pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
            },
          },
        },
        [`GET /repos/${REPO}/issues/42/comments`]: [
          { id: 501, user: { login: "my-gate-app[bot]", id: 9, type: "Bot" }, body: "<!-- agentlint:summary -->\nold" },
          { id: 502, user: BOT, body: "<!-- agentlint:summary -->\nquoted by another workflow's bot" },
        ],
      },
    });
    const writes = requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`);
    expect(writes).toContain(`PATCH /repos/${REPO}/issues/comments/501`);
    expect(writes).not.toContain(`PATCH /repos/${REPO}/issues/comments/502`);
  });
});

describe("base ref", () => {
  it("prefixes a branch name that contains a slash with origin/", async () => {
    const repo = await createRepo();
    await repo.git({ args: ["push", "-q", "origin", "main:refs/heads/release/1.x"], cwd: repo.work });
    await repo.git({ args: ["update-ref", "-d", "refs/remotes/origin/release/1.x"], cwd: repo.work });
    const { stubCalls } = await runAction({
      event: "pull_request",
      fixture: "pull_request.opened.json",
      extra: {
        GITHUB_WORKSPACE: repo.work,
        INPUT_BASE: "release/1.x",
      },
    });
    const check = stubCalls.find((call) => call.args[0] === "check");
    expect(check?.args.slice(0, 4)).toEqual(["check", "--all", "--base", "origin/release/1.x"]);
    expect(
      await repo.git({ args: ["rev-parse", "--verify", "refs/remotes/origin/release/1.x"], cwd: repo.work }),
    ).toMatch(/^[0-9a-f]+$/);
  });

  it("passes explicit refs through", async () => {
    const repo = await createRepo();
    for (const base of ["origin/main", "refs/remotes/origin/main", "HEAD"]) {
      const { stubCalls } = await runAction({
        event: "pull_request",
        fixture: "pull_request.opened.json",
        extra: {
          GITHUB_WORKSPACE: repo.work,
          INPUT_BASE: base,
        },
      });
      expect(stubCalls.find((call) => call.args[0] === "check")?.args[3]).toBe(base);
    }
  });
});
