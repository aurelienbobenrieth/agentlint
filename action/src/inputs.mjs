// @ts-check
/**
 * Action inputs and the resolution of the `version` input into the command that runs the agentlint CLI. Composite
 * actions do not expose `INPUT_*` automatically, so `action.yml` maps every input to `INPUT_<NAME>` itself.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Decode only the package-manifest fields needed to locate the local CLI.
 *
 * @param {string} text
 * @returns {{ bin?: string | Record<string, string>; version?: string }}
 */
function decodePackageManifest(text) {
  const value = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("invalid package manifest");
  const raw = /**
   * @type {Record<string, unknown>}
   */ (value);
  const version = raw["version"];
  const bin = raw["bin"];
  if (version !== undefined && typeof version !== "string") throw new TypeError("invalid package version");
  if (bin !== undefined && typeof bin !== "string") {
    if (typeof bin !== "object" || bin === null || Array.isArray(bin)) throw new TypeError("invalid package bin");
    for (const entry of Object.values(bin)) if (typeof entry !== "string") throw new TypeError("invalid package bin");
  }
  return {
    ...(typeof version === "string" ? { version } : {}),
    ...(typeof bin === "string" || (typeof bin === "object" && bin !== null)
      ? {
          bin: /**
           * @type {string | Record<string, string>}
           */ (bin),
        }
      : {}),
  };
}

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
 * @param {object} input
 * @param {NodeJS.ProcessEnv} input.env
 * @param {string} input.name
 * @param {string} input.fallback
 */
function input({ env, name, fallback }) {
  const dashed = env[`INPUT_${name.toUpperCase()}`];
  const underscored = env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`];
  const value = (dashed ?? underscored ?? "").trim();
  return value === "" ? fallback : value;
}

/**
 * @param {string} value
 */
function flag(value) {
  return value.toLowerCase() === "true";
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Inputs}
 */
export function readInputs(env) {
  return {
    version: input({ env, name: "version", fallback: "0.1.5" }),
    base: input({ env, name: "base", fallback: "" }),
    workingDirectory: input({ env, name: "working-directory", fallback: "." }),
    install: flag(input({ env, name: "install", fallback: "false" })),
    githubToken: input({ env, name: "github-token", fallback: "" }),
    comment: flag(input({ env, name: "comment", fallback: "true" })),
    dryRun: flag(input({ env, name: "dry-run", fallback: "false" })),
  };
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class InputError extends Error {
  /**
   * @param {string} detail
   */
  constructor(detail) {
    super(detail);
    this.name = "InputError";
  }
}

/**
 * The argv prefix that runs the agentlint CLI. Semver runs the published package through `npx`; `file:<path>` runs a
 * built checkout relative to the workspace root.
 *
 * @param {object} input
 * @param {string} input.version
 * @param {string} input.workspace Absolute path of the checkout root
 * @returns {string[]}
 */
export function resolveCli({ version, workspace }) {
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

/**
 * @param {string} version
 */
export function isPublishedVersion(version) {
  return SEMVER.test(version);
}

/**
 * The copy of `@aurelienbbn/agentlint` that the repository installed, looked up from the working directory up to the
 * workspace root the way Node resolves packages. `null` when there is none.
 *
 * @param {object} input
 * @param {string} input.workingDirectory Absolute
 * @param {string} input.workspace Absolute
 * @returns {Promise<{ argv: string[]; version: string } | null>}
 */
export async function localCli({ workingDirectory, workspace }) {
  /**
   * @param {string} dir
   */
  const findFrom = async (dir) => {
    const root = join(dir, "node_modules", "@aurelienbbn", "agentlint");
    const manifest = await readFile(join(root, "package.json"), "utf8")
      .then((text) => decodePackageManifest(text))
      .catch(() => {
        // REASON: a missing or invalid local manifest falls through to the parent-directory and npx strategies.
        return null;
      });
    if (manifest) {
      const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.["agentlint"];
      if (entry !== undefined) return { argv: ["node", resolve(root, entry)], version: manifest.version ?? "" };
    }
    if (dir === workspace || dirname(dir) === dir || !dir.startsWith(workspace)) return null;
    return findFrom(dirname(dir));
  };
  return findFrom(workingDirectory);
}

/**
 * On Windows `npx` is a `.cmd` shim, which Node refuses to spawn without a shell. Run the npm CLI that ships next to
 * the Node binary instead, so no argument ever passes through a shell.
 *
 * @returns {string[]}
 */
function npx() {
  return process.platform === "win32"
    ? [process.execPath, join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js")]
    : ["npx"];
}

/**
 * Install command from the lockfile present in the working directory, or in the workspace when the working directory
 * has none.
 *
 * @param {ReadonlyArray<string>} lockfiles File names present
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
