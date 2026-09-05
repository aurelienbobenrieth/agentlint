// @ts-check
/**
 * Minimal GitHub REST and GraphQL client over the global `fetch`. Reads always
 * go to the API. Every write goes through one writer that, in dry-run, records
 * the call instead of sending it. `git push` is a write too and uses the same
 * writer so a dry run never leaves the runner.
 */

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

export class GitHubError extends Error {
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
 * @property {(path: string) => Promise<unknown>} get resolves `null` when a dry run cannot read
 * @property {(path: string) => Promise<unknown[]>} paginate
 * @property {(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body: unknown) => Promise<unknown>} write
 * @property {(query: string, variables: Record<string, unknown>) => Promise<unknown>} graphql read-only query
 * @property {(query: string, variables: Record<string, unknown>) => Promise<unknown>} mutate
 * @property {(args: ReadonlyArray<string>, cwd: string) => Promise<void>} gitWrite
 */

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
 * @param {boolean} options.dryRun
 * @param {typeof fetch} options.fetchImpl
 * @param {Logger} options.log
 * @returns {GitHub}
 */
export function createGitHub(options) {
  const { token, apiUrl, graphqlUrl, dryRun, fetchImpl, log } = options;
  /** @type {PlanEntry[]} */
  const plan = [];

  /** @param {string} path */
  const url = (path) => (path.startsWith("http") ? path : `${apiUrl}${path}`);

  /**
   * @param {string} method
   * @param {string} target
   * @param {unknown} [body]
   * @returns {Promise<{ data: unknown, headers: Headers }>}
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
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new GitHubError(method, target, response.status, text.slice(0, 500));
    return { data: text === "" ? null : JSON.parse(text), headers: response.headers };
  }

  /**
   * A dry run only holds read scope on some events; a failed read degrades to
   * "nothing there" with a warning so the plan can still be printed.
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
        /** @type {unknown[]} */
        const items = [];
        const separator = path.includes("?") ? "&" : "?";
        /** @type {string | null} */
        let next = url(`${path}${separator}per_page=100`);
        while (next) {
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
    gitWrite: async (args, cwd) => {
      if (dryRun) {
        plan.push({ method: "GIT", url: `git ${args.join(" ")}`, body: null });
        log.info(`dry-run: git ${args.join(" ")}`);
        return;
      }
      const result = await git(args, cwd);
      if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
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
