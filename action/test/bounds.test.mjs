// @ts-check
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createGitHub } from "../src/github.mjs";
import { exec } from "../src/cli.mjs";

/**
 * @param {typeof fetch} fetchImpl
 */
const client = (fetchImpl) =>
  createGitHub({
    token: "fixture",
    apiUrl: "https://api.example.test",
    graphqlUrl: "https://api.example.test/graphql",
    dryRun: false,
    fetchImpl,
    log: { info() {}, warn() {}, error() {} },
  });

it("rejects repeated pages instead of looping or returning partial evidence", async () => {
  const calls = { value: 0 };
  const github = client(async (_input, init) => {
    calls.value += 1;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Response("[]", { headers: { link: '<https://api.example.test/items?per_page=100>; rel="next"' } });
  });
  await expect(github.paginate("/items")).rejects.toThrow(/repeated a page/);
  expect(calls.value).toBe(1);
});

it("rejects a pagination link to another origin before sending credentials", async () => {
  const calls = { value: 0 };
  const github = client(async () => {
    calls.value += 1;
    return new Response("[]", { headers: { link: '<https://other.example.test/items>; rel="next"' } });
  });
  await expect(github.paginate("/items")).rejects.toThrow(/changed API origin/);
  expect(calls.value).toBe(1);
});

it("collects distinct pages", async () => {
  const calls = { value: 0 };
  const github = client(async () =>
    ++calls.value === 1
      ? new Response('[{"id":1}]', { headers: { link: '<https://api.example.test/items?page=2>; rel="next"' } })
      : new Response('[{"id":2}]'),
  );
  await expect(github.paginate("/items")).resolves.toEqual([{ id: 1 }, { id: 2 }]);
});

it("terminates a stalled subprocess", async () => {
  await expect(
    exec({ argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"], options: { cwd: tmpdir(), timeoutMs: 100 } }),
  ).rejects.toThrow(/failed|killed|timed out/i);
});
