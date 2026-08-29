// @ts-check
/**
 * Process execution. Every command is an argv array passed to `execFile`; no
 * string ever reaches a shell, so user-provided reasons and selectors are inert.
 */

import { execFile } from "node:child_process";

/**
 * @typedef {object} ExecResult
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @param {ReadonlyArray<string>} argv
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<ExecResult>}
 */
export function exec(argv, options) {
  const [file, ...args] = argv;
  if (!file) return Promise.reject(new TypeError("exec: empty argv"));
  return new Promise((resolvePromise, reject) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, env: options.env ?? process.env, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
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
 * The agentlint CLI bound to the working directory. `AGENTLINT_ACTION_CLI_STUB`
 * replaces the command with `node <stub>` so tests can script the CLI.
 *
 * @param {ReadonlyArray<string>} command
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {Cli}
 */
export function createCli(command, cwd, env) {
  const stub = env["AGENTLINT_ACTION_CLI_STUB"];
  const prefix = stub ? ["node", stub] : [...command];
  return {
    cwd,
    run: (args, extra = {}) => exec([...prefix, ...args], { cwd, env: { ...env, ...extra } }),
  };
}

/**
 * @param {ReadonlyArray<string>} args
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} [env]
 */
export function git(args, cwd, env) {
  return exec(["git", ...args], { cwd, env: env ?? process.env });
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
