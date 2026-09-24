#!/usr/bin/env node

/**
 * Prove that the tracked composite Action starts outside this workspace without node_modules.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = mkdtempSync(join(tmpdir(), "agentlint-action-smoke-"));
const actionRoot = join(sandbox, "action");
const consumer = join(sandbox, "consumer");
mkdirSync(consumer, { recursive: true });

const tracked = execFileSync("git", ["ls-files", "action"], { cwd: repository, encoding: "utf8" })
  .trim()
  .split(/\r?\n/u)
  .filter(Boolean);

for (const file of tracked) {
  const relative = file.slice("action/".length);
  const target = join(actionRoot, relative);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(repository, file), target);
}

const result = spawnSync(process.execPath, [join(actionRoot, "src", "main.mjs")], {
  cwd: consumer,
  encoding: "utf8",
  env: {
    PATH: process.env["PATH"],
    SYSTEMROOT: process.env["SYSTEMROOT"],
    GITHUB_ACTION_PATH: actionRoot,
    GITHUB_EVENT_NAME: "",
    GITHUB_REPOSITORY: "agentlint/smoke",
    GITHUB_WORKSPACE: consumer,
  },
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exitCode = result.status ?? 1;
} else {
  process.stdout.write("Composite Action starts without workspace dependencies.\n");
}
