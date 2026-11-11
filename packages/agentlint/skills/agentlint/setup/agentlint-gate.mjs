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
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const mode = process.argv[2] === "edit" ? "edit" : "stop";
const root = resolve(import.meta.dirname, "../..");
const stateDir = ".agentlint/.cache";
const statePath = join(root, stateDir, "gate-hook.json");

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

const git = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : undefined;
};

const contentHash = (path) => {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    // REASON: a deleted path has no content; its status entry already records the deletion.
    return "absent";
  }
};

// HEAD, every staged, unstaged and untracked change, and the content of each changed
// file, so a second edit to an already changed file still counts. The hook's own state
// is left out. Undefined when git cannot answer: the gate then runs.
const treeFingerprint = () => {
  const head = git(["rev-parse", "--show-toplevel", "HEAD"]);
  const status = git(["status", "--porcelain", "-z", "--untracked-files=all", "--", ":/", `:(exclude)${stateDir}`]);
  if (head === undefined || status === undefined) return undefined;
  const top = head.split("\n")[0];
  const fingerprint = createHash("sha256").update(head).update(status);
  const entries = status.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length < 4) continue;
    // A rename or copy is followed by its source path, which has no entry of its own.
    if (/[RC]/.test(entry.slice(0, 2))) index += 1;
    const path = entry.slice(3);
    fingerprint.update(`${path}\0${contentHash(join(top, path))}\0`);
  }
  return fingerprint.digest("hex");
};

const readVerdict = () => {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    // REASON: no readable record means the tree was never judged.
    return undefined;
  }
};

const recordVerdict = (fingerprint, verdict) => {
  try {
    mkdirSync(join(root, stateDir), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify({ fingerprint, verdict })}\n`);
  } catch {
    // REASON: without a record the next stop runs the gate again, which is the safe side.
  }
};

const input = mode === "stop" ? readInput() : {};
// A stop that this hook already blocked continues, so a finding the agent cannot
// close (human authority) interrupts once instead of looping.
if (input.stop_hook_active === true) process.exit(0);

// The gate judges the work, not the turn: a stop over the same tree state as the last
// judged one reuses that verdict silently, so a question asked after coding ends
// normally and a closed gate is reported once. Any change to the tree, made by an edit
// tool or a shell, runs the complete gate.
const fingerprint = mode === "stop" ? treeFingerprint() : undefined;
if (fingerprint !== undefined && readVerdict()?.fingerprint === fingerprint) process.exit(0);

const bin = findBin();
if (!bin) {
  console.error("agentlint hook: @aurelienbbn/agentlint is not installed; gate skipped.");
  process.exit(0);
}

const result = spawnSync(process.execPath, [bin, "check", ...(mode === "stop" ? ["--all"] : [])], {
  cwd: root,
  encoding: "utf8",
});
if (fingerprint !== undefined && (result.status === 0 || result.status === 1)) {
  recordVerdict(fingerprint, result.status === 0 ? "open" : "closed");
}
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
