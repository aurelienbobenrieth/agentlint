// @ts-check
/**
 * Process execution. Every command is an argv array passed to `execFile`; no string ever reaches a shell, so
 * user-provided reasons and selectors are inert.
 */

import { execFile } from "node:child_process";

/**
 * Credentials that the runner or the workflow can place in the step environment. None of them may reach a process that
 * runs repository-controlled code: the package-manager install (lifecycle scripts), the agentlint CLI (which evaluates
 * `.agentlint/config.ts`), `npx`, or `git` (hooks and configuration in a checkout that such code has touched).
 */
export const CREDENTIAL_VARIABLES = Object.freeze([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "ACTIONS_CACHE_URL",
  "ACTIONS_RESULTS_URL",
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
]);

/**
 * The environment handed to every subprocess: the parent environment without the credentials above and without any
 * `INPUT_*` variable (`INPUT_GITHUB-TOKEN` carries the token; no child needs the other inputs). A denylist, because
 * package managers and Node need many benign variables (`PATH`, `HOME`, proxy and cache settings). `AGENTLINT_*`
 * variables pass through. Names compare case-insensitively, as Windows resolves them.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnv(env) {
  /**
   * @type {NodeJS.ProcessEnv}
   */
  const result = {};
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase();
    if (upper.startsWith("INPUT_") || CREDENTIAL_VARIABLES.includes(upper)) continue;
    result[name] = value;
  }
  return result;
}

/**
 * @typedef {object} ExecResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * Callers pass `childEnv(...)` for anything that runs repository-controlled code; the default is already scrubbed.
 *
 * @param {ReadonlyArray<string>} argv
 * @param {{ cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; shell?: boolean }} options
 * @returns {Promise<ExecResult>}
 */
export function exec(argv, options) {
  const [file, ...args] = argv;
  if (!file) return Promise.reject(new TypeError("exec: empty argv"));
  return new Promise((resolvePromise, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: options.env ?? childEnv(process.env),
        timeout: options.timeoutMs ?? 300_000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        shell: options.shell ?? false,
      },
      (error, stdout, stderr) => {
        const code = error?.code;
        if (error && typeof code !== "number") {
          reject(new Error(`${file} ${args.join(" ")}: ${error.message}`));
          return;
        }
        resolvePromise({ code: typeof code === "number" ? code : 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * @typedef {object} Cli
 * @property {(args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) => Promise<ExecResult>} run
 * @property {string} cwd
 */

/**
 * The agentlint CLI bound to the working directory. `AGENTLINT_ACTION_CLI_STUB` replaces the command with `node <stub>`
 * so tests can script the CLI.
 *
 * `local` is asked on the first run, which is after the install: when the repository installed its own copy of the
 * package, that copy runs instead of `command`, so one Effect runtime is loaded rather than two.
 *
 * @param {ReadonlyArray<string>} command
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @param {{ local?: () => Promise<string[] | null> }} [options]
 * @returns {Cli}
 */
export function createCli(command, cwd, env, options = {}) {
  const stub = env["AGENTLINT_ACTION_CLI_STUB"];
  /**
   * @type {Promise<string[]> | null}
   */
  let prefix = null;
  const resolvePrefix = async () => (stub ? ["node", stub] : ((await options.local?.()) ?? [...command]));
  return {
    cwd,
    run: async (args, extra = {}) => {
      prefix ??= resolvePrefix();
      return exec([...(await prefix), ...args], { cwd, env: { ...childEnv(env), ...extra } });
    },
  };
}

/**
 * `git` never inherits a credential: hooks and configuration in the checkout may have been written by repository code.
 *
 * @param {ReadonlyArray<string>} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 */
export function git(args, cwd, env) {
  return exec(["git", ...args], { cwd, env: childEnv(env ?? process.env) });
}

/**
 * @param {ReadonlyArray<string>} args
 * @param {string} cwd
 * @returns {Promise<string>}
 */
export async function gitOutput(args, cwd) {
  const result = await git(args, cwd);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}
