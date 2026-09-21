// @ts-check
/**
 * Minimal GitHub REST and GraphQL client over the global `fetch`. Reads always go to the API. Every write goes through
 * one writer that, in dry-run, records the call instead of sending it. `git push` is a write too and uses the same
 * writer so a dry run never leaves the runner.
 */

import { devNull } from "node:os";
import { Array as A, Schema } from "effect";

import { git } from "./cli.mjs";
import { isRecord } from "./artifact.mjs";

const isNumber = Schema.is(Schema.Number);
const isString = Schema.is(Schema.String);

/**
 * @typedef {object} PlanEntry
 * @property {string} method
 * @property {string} url
 * @property {unknown} body
 */

/**
 * @typedef {object} Logger
 * @property {(message: string) => void} info
 * @property {(message: string) => void} warn
 * @property {(message: string) => void} error
 */

class GitHubError extends Error {
  /**
   * @param {object} input
   * @param {string} input.method
   * @param {string} input.url
   * @param {number} input.status
   * @param {string} input.detail
   */
  constructor({ method, url, status, detail }) {
    super(`${method} ${url} failed with ${status}: ${detail}`);
    this.name = "GitHubError";
    this.status = status;
  }
}

/**
 * @typedef {object} GitHub
 * @property {boolean} dryRun
 * @property {PlanEntry[]} plan
 * @property {(path: string) => Promise<unknown>} get Resolves `null` when a dry run cannot read
 * @property {(path: string) => Promise<unknown[]>} paginate
 * @property {(input: { method: "POST" | "PATCH" | "PUT" | "DELETE"; path: string; body: unknown }) => Promise<unknown>} write
 * @property {(input: { query: string; variables: Record<string, unknown> }) => Promise<unknown>} graphql Read-only
 *   query
 * @property {(input: { query: string; variables: Record<string, unknown> }) => Promise<unknown>} mutate
 * @property {(input: { args: ReadonlyArray<string>; cwd: string }) => Promise<import("./cli.mjs").ExecResult>} gitFetch
 *   Authenticated `git fetch`
 * @property {(input: { args: ReadonlyArray<string>; cwd: string }) => Promise<import("./cli.mjs").ExecResult>} gitWrite
 *   Authenticated `git push`; a dry run records it and reports success
 * @property {() => Promise<string>} identity Login of the account the token acts as
 */

/**
 * The account behind the default `GITHUB_TOKEN`.
 */
const DEFAULT_IDENTITY = "github-actions[bot]";

/**
 * Git options that authenticate one command against `serverUrl` with the token, the way `actions/checkout` does, but on
 * the command line only: nothing is written to `.git/config`, so the checkout can use `persist-credentials: false` and
 * no later process finds a credential on disk.
 *
 * Git hands `-c` values to its own children through `GIT_CONFIG_PARAMETERS`, and argv is visible to processes of the
 * same user. No repository code runs while a fetch or a push is in flight, but code that ran earlier in the job (an
 * install script, the configuration) could have left a hook or a helper behind. So hooks, credential helpers, the
 * `ext::` transport, and push signing are switched off for the command. The header is scoped to the server URL: a
 * rewritten remote on another host never receives it. The empty value first clears a header that a checkout persisted;
 * two `Authorization` headers are rejected by GitHub.
 *
 * @param {object} input
 * @param {string} input.serverUrl
 * @param {string} input.token
 * @returns {string[]}
 */
export function gitAuthOptions({ serverUrl, token }) {
  const hardening = [
    "-c",
    `core.hooksPath=${devNull}`,
    "-c",
    "credential.helper=",
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "push.gpgSign=false",
  ];
  if (token === "") return hardening;
  const key = `http.${serverUrl.replace(/\/+$/, "")}/.extraheader`;
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  return [...hardening, "-c", `${key}=`, "-c", `${key}=AUTHORIZATION: basic ${basic}`];
}

/**
 * @param {Headers} headers
 * @returns {string | null}
 */
function nextLink(headers) {
  const link = headers.get("link");
  if (!link) return null;
  for (const part of link.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * @param {object} options
 * @param {string} options.token
 * @param {string} options.apiUrl
 * @param {string} options.graphqlUrl
 * @param {string} [options.serverUrl] Default: https://github.com
 * @param {boolean} options.dryRun
 * @param {typeof fetch} options.fetchImpl
 * @param {Logger} options.log
 * @param {number} [options.requestTimeoutMs] HTTP deadline, including response bodies. Default: 30 seconds.
 * @returns {GitHub}
 */
export function createGitHub(options) {
  const { token, apiUrl, graphqlUrl, dryRun, fetchImpl, log } = options;
  /**
   * @type {PlanEntry[]}
   */
  const plan = [];
  const authOptions = gitAuthOptions({ serverUrl: options.serverUrl ?? "https://github.com", token });
  /**
   * @type {{ identity: Promise<string> | null }}
   */
  const memo = { identity: null };

  /**
   * Run an authenticated git command. Git does not print the header, but a failure is logged and posted to the pull
   * request, and a spawn error quotes argv, so every text that leaves here is redacted.
   *
   * @param {object} input
   * @param {ReadonlyArray<string>} input.args
   * @param {string} input.cwd
   * @returns {Promise<import("./cli.mjs").ExecResult>}
   */
  async function authenticatedGit({ args, cwd }) {
    const secrets = A.filter([token, Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")], Boolean);
    const clean = (
      /**
       * @type {string}
       */ text,
    ) => secrets.reduce((acc, secret) => acc.replaceAll(secret, "***"), text);
    try {
      const result = await git({ args: [...authOptions, ...args], cwd });
      return { code: result.code, stdout: clean(result.stdout), stderr: clean(result.stderr) };
    } catch (error) {
      throw new Error(clean(error instanceof Error ? error.message : String(error)), { cause: error });
    }
  }

  /**
   * @param {string} path
   */
  const url = (path) => (path.startsWith("http") ? path : `${apiUrl}${path}`);

  /**
   * @param {object} input
   * @param {string} input.method
   * @param {string} input.target
   * @param {unknown} [input.body]
   * @returns {Promise<{ data: unknown; headers: Headers }>}
   */
  async function send({ method, target, body }) {
    const response = await fetchImpl(target, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "agentlint-action",
        "x-github-api-version": "2022-11-28",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
    });
    const text = await response.text();
    if (!response.ok)
      throw new GitHubError({ method, url: target, status: response.status, detail: text.slice(0, 500) });
    return { data: text === "" ? null : JSON.parse(text), headers: response.headers };
  }

  /**
   * A dry run only holds read scope on some events; a failed read degrades to "nothing there" with a warning so the
   * plan can still be printed.
   *
   * @template T
   * @param {object} input
   * @param {() => Promise<T>} input.read
   * @param {T} input.fallback
   */
  async function tolerate({ read, fallback }) {
    try {
      return await read();
    } catch (error) {
      if (!dryRun || !(error instanceof GitHubError)) throw error;
      log.warn(`dry-run: read failed, continuing with nothing: ${error.message}`);
      return fallback;
    }
  }

  /**
   * @param {object} input
   * @param {string} input.method
   * @param {string} input.target
   * @param {unknown} input.body
   */
  async function write({ method, target, body }) {
    if (dryRun) {
      plan.push({ method, url: target, body });
      log.info(`dry-run: ${method} ${target}`);
      return null;
    }
    return (await send({ method, target, body })).data;
  }

  /**
   * @param {object} input
   * @param {string} input.query
   * @param {Record<string, unknown>} input.variables
   */
  async function graphql({ query, variables }) {
    const { data } = await send({ method: "POST", target: graphqlUrl, body: { query, variables } });
    if (isRecord(data) && Array.isArray(data["errors"]) && data["errors"].length > 0) {
      throw new GitHubError({
        method: "POST",
        url: graphqlUrl,
        status: 200,
        detail: JSON.stringify(data["errors"]).slice(0, 500),
      });
    }
    return isRecord(data) ? data["data"] : null;
  }

  return {
    dryRun,
    plan,
    get: (path) =>
      tolerate({ read: async () => (await send({ method: "GET", target: url(path) })).data, fallback: null }),
    paginate: (path) =>
      tolerate({
        read: async () => {
          /**
           * @type {unknown[]}
           */
          const items = [];
          const separator = path.includes("?") ? "&" : "?";
          /**
           * @type {{ next: string | null }}
           */
          const pagination = { next: url(`${path}${separator}per_page=100`) };
          const seen = new Set();
          while (pagination.next) {
            if (new URL(pagination.next).origin !== new URL(apiUrl).origin)
              throw new Error("GitHub pagination changed API origin");
            if (seen.has(pagination.next) || seen.size >= 1_000)
              throw new Error("GitHub pagination repeated a page or exceeded 1000 pages");
            seen.add(pagination.next);
            const page = await send({ method: "GET", target: pagination.next });
            if (Array.isArray(page.data)) items.push(...page.data);
            pagination.next = nextLink(page.headers);
          }
          return items;
        },
        fallback: [],
      }),
    write: ({ method, path, body }) => write({ method, target: url(path), body }),
    graphql: ({ query, variables }) => tolerate({ read: () => graphql({ query, variables }), fallback: null }),
    mutate: async ({ query, variables }) => {
      if (dryRun) {
        plan.push({ method: "GRAPHQL", url: graphqlUrl, body: { query, variables } });
        log.info(`dry-run: GRAPHQL ${query.trim().split("\n")[0]}`);
        return null;
      }
      return graphql({ query, variables });
    },
    gitFetch: ({ args, cwd }) => authenticatedGit({ args: ["fetch", ...args], cwd }),
    gitWrite: async ({ args, cwd }) => {
      if (dryRun) {
        plan.push({ method: "GIT", url: `git push ${args.join(" ")}`, body: null });
        log.info(`dry-run: git push ${args.join(" ")}`);
        return { code: 0, stdout: "", stderr: "" };
      }
      return authenticatedGit({ args: ["push", ...args], cwd });
    },
    identity: () => {
      // The REST `/user` endpoint refuses installation tokens; the GraphQL viewer answers for every token kind.
      memo.identity ??= tolerate({
        read: () => graphql({ query: "query { viewer { login } }", variables: {} }),
        fallback: null,
      })
        .catch(() => {
          // REASON: identity lookup has an explicit conservative fallback for restricted tokens.
          return null;
        })
        .then((data) => {
          const login = stringField({ record: isRecord(data) ? data["viewer"] : undefined, key: "login" });
          if (login !== "") return login;
          log.warn(`could not resolve the token's account; assuming ${DEFAULT_IDENTITY}`);
          return DEFAULT_IDENTITY;
        });
      return memo.identity;
    },
  };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function numberField(value) {
  return isNumber(value) ? value : null;
}

/**
 * @param {object} input
 * @param {unknown} input.record
 * @param {string} input.key
 * @returns {string}
 */
export function stringField({ record, key }) {
  const value = isRecord(record) ? record[key] : undefined;
  return isString(value) ? value : "";
}
