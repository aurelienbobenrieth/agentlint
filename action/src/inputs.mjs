// @ts-check
/**
 * Action inputs and the resolution of the `version` input into the command
 * that runs the agentlint CLI. Composite actions do not expose `INPUT_*`
 * automatically, so `action.yml` maps every input to `INPUT_<NAME>` itself.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * @typedef {object} Inputs
 * @property {string} version
 * @property {string} base
 * @property {string} workingDirectory
 * @property {boolean} install
 * @property {string} githubToken
 * @property {boolean} comment
 * @property {boolean} dryRun
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {string} fallback
 */
function input(env, name, fallback) {
  const dashed = env[`INPUT_${name.toUpperCase()}`];
  const underscored = env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`];
  const value = (dashed ?? underscored ?? "").trim();
  return value === "" ? fallback : value;
}

/** @param {string} value */
function flag(value) {
  return value.toLowerCase() === "true";
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Inputs}
 */
export function readInputs(env) {
  return {
    version: input(env, "version", "0.1.5"),
    base: input(env, "base", ""),
    workingDirectory: input(env, "working-directory", "."),
    install: flag(input(env, "install", "false")),
    githubToken: input(env, "github-token", ""),
    comment: flag(input(env, "comment", "true")),
    dryRun: flag(input(env, "dry-run", "false")),
  };
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class InputError extends Error {
  /** @param {string} detail */
  constructor(detail) {
    super(detail);
    this.name = "InputError";
  }
}

/**
 * The argv prefix that runs the agentlint CLI. Semver runs the published
 * package through `npx`; `file:<path>` runs a built checkout relative to the
 * workspace root.
 *
 * @param {string} version
 * @param {string} workspace absolute path of the checkout root
 * @returns {string[]}
 */
export function resolveCli(version, workspace) {
  if (version.startsWith("file:")) {
    const path = version.slice("file:".length).trim();
    if (path === "") throw new InputError("version: file: needs a path");
    return ["node", resolve(workspace, path, "dist/bin.mjs")];
  }
  if (!SEMVER.test(version)) {
    throw new InputError(`version: expected a semver version or file:<path>, got "${version}"`);
  }
  return [...npx(), "--yes", `@aurelienbbn/agentlint@${version}`];
}

/** @param {string} version */
export function isPublishedVersion(version) {
  return SEMVER.test(version);
}

/**
 * The copy of `@aurelienbbn/agentlint` that the repository installed, looked up from the working directory up to the
 * workspace root the way Node resolves packages. `null` when there is none.
 *
 * @param {string} workingDirectory absolute
 * @param {string} workspace absolute
 * @returns {Promise<{ argv: string[], version: string } | null>}
 */
export async function localCli(workingDirectory, workspace) {
  for (let dir = workingDirectory; ; dir = dirname(dir)) {
    const root = join(dir, "node_modules", "@aurelienbbn", "agentlint");
    const manifest = await readFile(join(root, "package.json"), "utf8").then(
      (text) => /** @type {unknown} */ (JSON.parse(text)),
      () => null,
    );
    if (typeof manifest === "object" && manifest !== null) {
      const { bin, version } = /** @type {{ bin?: unknown, version?: unknown }} */ (manifest);
      const entry =
        typeof bin === "string"
          ? bin
          : typeof bin === "object" && bin !== null
            ? /** @type {Record<string, unknown>} */ (bin)["agentlint"]
            : undefined;
      if (typeof entry === "string") {
        return { argv: ["node", resolve(root, entry)], version: typeof version === "string" ? version : "" };
      }
    }
    if (dir === workspace || dirname(dir) === dir || !dir.startsWith(workspace)) return null;
  }
}

/**
 * On Windows `npx` is a `.cmd` shim, which Node refuses to spawn without a shell. Run the npm CLI that ships next to the
 * Node binary instead, so no argument ever passes through a shell.
 *
 * @returns {string[]}
 */
function npx() {
  return process.platform === "win32"
    ? [process.execPath, join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js")]
    : ["npx"];
}

/**
 * Install command from the lockfile present in the working directory, or in
 * the workspace when the working directory has none.
 *
 * @param {ReadonlyArray<string>} lockfiles file names present
 * @returns {string[] | null}
 */
export function installCommand(lockfiles) {
  const present = new Set(lockfiles);
  if (present.has("pnpm-lock.yaml")) return ["pnpm", "install", "--frozen-lockfile"];
  if (present.has("bun.lock") || present.has("bun.lockb")) return ["bun", "install", "--frozen-lockfile"];
  if (present.has("yarn.lock")) return ["yarn", "install", "--immutable"];
  if (present.has("package-lock.json") || present.has("npm-shrinkwrap.json")) return ["npm", "ci"];
  return null;
}
