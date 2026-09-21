// @ts-check
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CREDENTIAL_VARIABLES, childEnv } from "../src/cli.mjs";
import { gitAuthOptions } from "../src/github.mjs";
import { localCli } from "../src/inputs.mjs";
import { isActionComment } from "../src/render.mjs";

/**
 * @type {string[]}
 */
const cleanup = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("childEnv", () => {
  it("removes every credential and every input, and keeps the rest", () => {
    expect([...CREDENTIAL_VARIABLES].toSorted()).toEqual([
      "ACTIONS_CACHE_URL",
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_URL",
      "ACTIONS_RESULTS_URL",
      "ACTIONS_RUNTIME_TOKEN",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "NODE_AUTH_TOKEN",
      "NPM_TOKEN",
    ]);
    /**
     * @type {NodeJS.ProcessEnv}
     */
    const parent = Object.fromEntries(CREDENTIAL_VARIABLES.map((name) => [name, "secret"]));
    Object.assign(parent, {
      "INPUT_GITHUB-TOKEN": "secret",
      INPUT_GITHUB_TOKEN: "secret",
      INPUT_VERSION: "0.1.5",
      "input_github-token": "secret",
      gh_token: "secret",
      PATH: "/usr/bin",
      HOME: "/home/runner",
      HTTPS_PROXY: "http://proxy",
      GITHUB_REPOSITORY: "o/r",
      AGENTLINT_ACTOR: "human:someone",
    });
    expect(childEnv(parent)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/runner",
      HTTPS_PROXY: "http://proxy",
      GITHUB_REPOSITORY: "o/r",
      AGENTLINT_ACTOR: "human:someone",
    });
  });
});

describe("gitAuthOptions", () => {
  it("authenticates one command for the server only, after clearing a persisted header", () => {
    const options = gitAuthOptions("https://github.com/", "tok");
    const basic = Buffer.from("x-access-token:tok").toString("base64");
    expect(options.slice(-4)).toEqual([
      "-c",
      "http.https://github.com/.extraheader=",
      "-c",
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`,
    ]);
    expect(options.some((option) => option.startsWith("core.hooksPath="))).toBe(true);
    expect(options).toContain("credential.helper=");
    expect(options).toContain("protocol.ext.allow=never");
    expect(gitAuthOptions("https://github.com", "").join(" ")).not.toContain("extraheader");
  });
});

describe("isActionComment", () => {
  const marker = "<!-- agentlint:summary -->";
  it("trusts only the account of the token in use", () => {
    const own = { user: { login: "github-actions[bot]", type: "Bot" }, body: marker };
    expect(isActionComment(own, "github-actions[bot]")).toBe(true);
    expect(isActionComment(own, "github-actions")).toBe(true);
    expect(
      isActionComment({ user: { login: "other-app[bot]", type: "Bot" }, body: marker }, "github-actions[bot]"),
    ).toBe(false);
    expect(
      isActionComment({ user: { login: "github-actions", type: "User" }, body: marker }, "github-actions[bot]"),
    ).toBe(false);
    expect(isActionComment({ user: { login: "my-app[bot]", type: "Bot" }, body: marker }, "my-app[bot]")).toBe(true);
    expect(isActionComment({ user: { login: "maintainer", type: "User" }, body: marker }, "maintainer")).toBe(true);
    expect(isActionComment(own, "")).toBe(false);
  });
});

describe("localCli", () => {
  it("finds the copy the repository installed, from the working directory up to the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agentlint-local-"));
    cleanup.push(workspace);
    const working = join(workspace, "apps", "web");
    await mkdir(working, { recursive: true });
    expect(await localCli(working, workspace)).toBeNull();

    const root = join(workspace, "node_modules", "@aurelienbbn", "agentlint");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ version: "0.1.4", bin: { agentlint: "dist/bin.mjs" } }),
    );
    expect(await localCli(working, workspace)).toEqual({
      argv: ["node", join(root, "dist", "bin.mjs")],
      version: "0.1.4",
    });
  });
});
