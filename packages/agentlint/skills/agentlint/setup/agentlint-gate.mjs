#!/usr/bin/env node
// Coding-agent hook adapter for the agentlint gate. Copy to .agentlint/hooks/agentlint-gate.mjs.
//
//   node .agentlint/hooks/agentlint-gate.mjs stop   Stop hook: complete gate (`check --all`)
//   node .agentlint/hooks/agentlint-gate.mjs edit   PostToolUse hook: changed files (`check`)
//
// Claude Code and Codex share the contract used here: hook input is JSON on stdin,
// exit code 2 hands stderr back to the agent, and `stop_hook_active` marks a stop
// that a hook already blocked once. The adapter owns no gate semantics.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const mode = process.argv[2] === "edit" ? "edit" : "stop";
const root = resolve(import.meta.dirname, "../..");

const readInput = () => {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    // REASON: missing stdin means there is no prior gate payload to merge.
    return {};
  }
};

const findFrom = (directory) => {
  const candidate = join(directory, "node_modules/@aurelienbbn/agentlint/dist/bin.mjs");
  if (existsSync(candidate)) return candidate;
  if (dirname(directory) === directory) return undefined;
  return findFrom(dirname(directory));
};

const findBin = () => findFrom(root);

// A stop that this hook already blocked continues, so a finding the agent cannot
// close (human authority) interrupts once instead of looping.
if (mode === "stop" && readInput().stop_hook_active === true) process.exit(0);

const bin = findBin();
if (!bin) {
  console.error("agentlint hook: @aurelienbbn/agentlint is not installed; gate skipped.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [bin, "check", ...(mode === "stop" ? ["--all"] : [])], {
  cwd: root,
  encoding: "utf8",
});
if (result.status === 0) process.exit(0);

const output = `${result.stdout}${result.stderr}`.trim();
const instruction =
  result.status === 1
    ? mode === "stop"
      ? "The agentlint gate is closed. Resolve every finding: change the evidence, or `accept` an agent-authority finding with a concrete reason. For a human-authority finding, `propose` your work and tell the user to run `agentlint review`."
      : "agentlint reported unresolved findings for the current change. Resolve them before you finish."
    : "agentlint could not evaluate the gate. Fix the configuration or evidence error first.";
console.error(`${output}\n\n${instruction}`);
process.exit(2);
