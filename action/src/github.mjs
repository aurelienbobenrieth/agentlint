// @ts-check
/**
 * Minimal GitHub REST and GraphQL client over the global `fetch`. Reads always go to the API. Every write goes through
 * one writer that, in dry-run, records the call instead of sending it. `git push` is a write too and uses the same
 * writer so a dry run never leaves the runner.
 */

import { devNull } from "node:os";

import { git } from "./cli.mjs";
import { isRecord } from "./artifact.mjs";

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
   * @param {string} method
   * @param {string} url
   * @param {number} status
   * @param {string} detail
   */
  constructor(method, url, status, detail) {
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
 * @property {(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body: unknown) => Promise<unknown>} write
 * @property {(query: string, variables: Record<string, unknown>) => Promise<unknown>} graphql Read-only query
 * @property {(query: string, variables: Record<string, unknown>) => Promise<unknown>} mutate
 * @property {(args: ReadonlyArray<string>, cwd: string) => Promise<import("./cli.mjs").ExecResult>} gitFetch
 *   Authenticated `git fetch`
 * @property {(args: ReadonlyArray<string>, cwd: string) => Promise<import("./cli.mjs").ExecResult>} gitWrite
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
 * @param {string} serverUrl
 * @param {string} token
 * @returns {string[]}
 */
export function gitAuthOptions(serverUrl, token) {
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
  const authOptions = gitAuthOptions(options.serverUrl ?? "https://github.com", token);
  /**
   * @type {Promise<string> | null}
   */
  let identity = null;

  /**
   * Run an authenticated git command. Git does not print the header, but a failure is logged and posted to the pull
   * request, and a spawn error quotes argv, so every text that leaves here is redacted.
   *
   * @param {ReadonlyArray<string>} args
   * @param {string} cwd
   * @returns {Promise<import("./cli.mjs").ExecResult>}
   */
  async function authenticatedGit(args, cwd) {
    const secrets = [token, Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")].filter(Boolean);
    const clean = (
      /**
       * @type {string}
       */ text,
    ) => secrets.reduce((acc, secret) => acc.replaceAll(secret, "***"), text);
    try {
      const result = await git([...authOptions, ...args], cwd);
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
   * @param {string} method
   * @param {string} target
   * @param {unknown} [body]
   * @returns {Promise<{ data: unknown; headers: Headers }>}
   */
  async function send(method, target, body) {
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
    if (!response.ok) throw new GitHubError(method, target, response.status, text.slice(0, 500));
    return { data: text === "" ? null : JSON.parse(text), headers: response.headers };
  }

  /**
   * A dry run only holds read scope on some events; a failed read degrades to "nothing there" with a warning so the
   * plan can still be printed.
   *
   * @template T
   * @param {() => Promise<T>} read
   * @param {T} fallback
   */
  async function tolerate(read, fallback) {
    try {
      return await read();
    } catch (error) {
      if (!dryRun || !(error instanceof GitHubError)) throw error;
      log.warn(`dry-run: read failed, continuing with nothing: ${error.message}`);
      return fallback;
    }
  }

  /**
   * @param {string} method
   * @param {string} target
   * @param {unknown} body
   */
  async function write(method, target, body) {
    if (dryRun) {
      plan.push({ method, url: target, body });
      log.info(`dry-run: ${method} ${target}`);
      return null;
    }
    return (await send(method, target, body)).data;
  }

  /**
   * @param {string} query
   * @param {Record<string, unknown>} variables
   */
  async function graphql(query, variables) {
    const { data } = await send("POST", graphqlUrl, { query, variables });
    if (isRecord(data) && Array.isArray(data["errors"]) && data["errors"].length > 0) {
      throw new GitHubError("POST", graphqlUrl, 200, JSON.stringify(data["errors"]).slice(0, 500));
    }
    return isRecord(data) ? data["data"] : null;
  }

  return {
    dryRun,
    plan,
    get: (path) => tolerate(async () => (await send("GET", url(path))).data, null),
    paginate: (path) =>
      tolerate(async () => {
        /**
         * @type {unknown[]}
         */
        const items = [];
        const separator = path.includes("?") ? "&" : "?";
        /**
         * @type {string | null}
         */
        let next = url(`${path}${separator}per_page=100`);
        const seen = new Set();
        while (next) {
          if (new URL(next).origin !== new URL(apiUrl).origin) throw new Error("GitHub pagination changed API origin");
          if (seen.has(next) || seen.size >= 1_000)
            throw new Error("GitHub pagination repeated a page or exceeded 1000 pages");
          seen.add(next);
          const page = await send("GET", next);
          if (Array.isArray(page.data)) items.push(...page.data);
          next = nextLink(page.headers);
        }
        return items;
      }, []),
    write: (method, path, body) => write(method, url(path), body),
    graphql: (query, variables) => tolerate(() => graphql(query, variables), null),
    mutate: async (query, variables) => {
      if (dryRun) {
        plan.push({ method: "GRAPHQL", url: graphqlUrl, body: { query, variables } });
        log.info(`dry-run: GRAPHQL ${query.trim().split("\n")[0]}`);
        return null;
      }
      return graphql(query, variables);
    },
    gitFetch: (args, cwd) => authenticatedGit(["fetch", ...args], cwd),
    gitWrite: async (args, cwd) => {
      if (dryRun) {
        plan.push({ method: "GIT", url: `git push ${args.join(" ")}`, body: null });
        log.info(`dry-run: git push ${args.join(" ")}`);
        return { code: 0, stdout: "", stderr: "" };
      }
      return authenticatedGit(["push", ...args], cwd);
    },
    identity: () => {
      // The REST `/user` endpoint refuses installation tokens; the GraphQL viewer answers for every token kind.
      identity ??= tolerate(() => graphql("query { viewer { login } }", {}), null)
        .catch(() => null)
        .then((data) => {
          const login = stringField(isRecord(data) ? data["viewer"] : undefined, "login");
          if (login !== "") return login;
          log.warn(`could not resolve the token's account; assuming ${DEFAULT_IDENTITY}`);
          return DEFAULT_IDENTITY;
        });
      return identity;
    },
  };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function numberField(value) {
  return typeof value === "number" ? value : null;
}

/**
 * @param {unknown} record
 * @param {string} key
 * @returns {string}
 */
export function stringField(record, key) {
  const value = isRecord(record) ? record[key] : undefined;
  return typeof value === "string" ? value : "";
}
