// @ts-check
/**
 * Entry point of the composite action. Reads the event and the inputs from the
 * environment, dispatches to the gate or the command flow, writes the step
 * outputs, and exits with the gate code.
 */

import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isRecord } from "./artifact.mjs";
import { createCli } from "./cli.mjs";
import { runCommand } from "./commands.mjs";
import { runGate } from "./gate.mjs";
import { createGitHub } from "./github.mjs";
import { InputError, readInputs, resolveCli } from "./inputs.mjs";

/** @typedef {import("./gate.mjs").Context} Context */

/**
 * @param {(line: string) => void} write
 * @returns {import("./github.mjs").Logger}
 */
export function createLogger(write) {
  return {
    info: (message) => write(message),
    warn: (message) => write(`::warning::${message}`),
    error: (message) => write(`::error::${message}`),
  };
}

/**
 * @param {string} path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readEvent(path) {
  if (path === "") return {};
  const raw = JSON.parse(await readFile(path, "utf8"));
  return isRecord(raw) ? raw : {};
}

/**
 * @param {Map<string, string>} outputs
 * @param {string} path
 */
async function writeOutputs(outputs, path) {
  let text = "";
  for (const [name, value] of outputs) {
    const delimiter = `ghadelimiter_${randomUUID()}`;
    text += `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  }
  await appendFile(path, text, "utf8");
}

/**
 * @param {object} options
 * @param {NodeJS.ProcessEnv} options.env
 * @param {typeof fetch} [options.fetchImpl]
 * @param {import("./github.mjs").Logger} [options.log]
 * @returns {Promise<{ exitCode: number, outputs: Map<string, string> }>}
 */
export async function run(options) {
  const { env } = options;
  const log = options.log ?? createLogger((line) => process.stdout.write(`${line}\n`));
  /** @type {Map<string, string>} */
  const outputs = new Map([
    ["gate", ""],
    ["unresolved", ""],
    ["human", ""],
    ["artifact", ""],
    ["dry-run-plan", "[]"],
  ]);

  let exitCode = 0;
  /** @type {Context["github"] | null} */
  let github = null;
  try {
    const inputs = readInputs(env);
    const workspace = resolve(env["GITHUB_WORKSPACE"] ?? process.cwd());
    const workingDirectory = resolve(workspace, inputs.workingDirectory);
    const eventName = env["GITHUB_EVENT_NAME"] ?? "";
    if (eventName === "pull_request_target") {
      throw new InputError(
        "pull_request_target is unsupported: repository configuration executes code. Use pull_request with least-privilege permissions.",
      );
    }
    const event = await readEvent(env["GITHUB_EVENT_PATH"] ?? "");
    github = createGitHub({
      token: inputs.githubToken,
      apiUrl: env["GITHUB_API_URL"] ?? "https://api.github.com",
      graphqlUrl: env["GITHUB_GRAPHQL_URL"] ?? "https://api.github.com/graphql",
      dryRun: inputs.dryRun,
      fetchImpl: options.fetchImpl ?? fetch,
      log,
    });
    /** @type {Context} */
    const ctx = {
      inputs,
      env,
      eventName,
      event,
      repository: env["GITHUB_REPOSITORY"] ?? "",
      serverUrl: env["GITHUB_SERVER_URL"] ?? "https://github.com",
      workspace,
      workingDirectory,
      github,
      cli: createCli(resolveCli(inputs.version, workspace), workingDirectory, env),
      log,
      outputs,
    };
    if (ctx.repository === "") throw new InputError("GITHUB_REPOSITORY is not set");
    if (inputs.dryRun) log.info("dry-run: writes are recorded, not sent");

    if (eventName === "pull_request" || eventName === "pull_request_target") {
      exitCode = await runGate(ctx);
    } else if (eventName === "issue_comment" || eventName === "pull_request_review_comment") {
      exitCode = await runCommand(ctx);
    } else {
      log.info(`event ${eventName || "(none)"}: nothing to do`);
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    if (outputs.get("gate") === "") outputs.set("gate", "error");
    exitCode = 2;
  }
  if (github) {
    outputs.set("dry-run-plan", JSON.stringify(github.plan));
    if (github.dryRun) log.info(`dry-run plan:\n${JSON.stringify(github.plan, null, 2)}`);
  }
  const outputPath = env["GITHUB_OUTPUT"];
  if (outputPath) await writeOutputs(outputs, outputPath);
  return { exitCode, outputs };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  const { exitCode } = await run({ env: process.env });
  process.exitCode = exitCode;
}
