#!/usr/bin/env node
// Coding-agent hook adapter for the agentlint gate. Copy to .agentlint/hooks/agentlint-gate.mjs.
//
//   node .agentlint/hooks/agentlint-gate.mjs prompt  UserPromptSubmit hook: records the turn's starting state
//   node .agentlint/hooks/agentlint-gate.mjs stop    Stop hook: complete gate (`check --all`)
//   node .agentlint/hooks/agentlint-gate.mjs edit    PostToolUse hook: changed files (`check`)
//
// Claude Code and Codex share the contract used here: hook input is JSON on stdin,
// exit code 2 hands stderr back to the agent, `stop_hook_active` marks a stop that a
// hook already blocked once, and `session_id` names the conversation. The adapter owns
// no gate semantics.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const mode = ["edit", "prompt"].includes(process.argv[2]) ? process.argv[2] : "stop";
const root = resolve(import.meta.dirname, "../..");
const stateDir = ".agentlint/.cache";

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

// One baseline per conversation, so sessions sharing a checkout never overwrite each
// other's. The id is hashed because hosts do not promise a filename-safe value.
const baselinePath = (sessionId) => {
  const key = typeof sessionId === "string" ? createHash("sha256").update(sessionId).digest("hex") : "default";
  return join(root, stateDir, "gate-hook", `${key}.json`);
};

const readBaseline = (sessionId) => {
  try {
    return JSON.parse(readFileSync(baselinePath(sessionId), "utf8")).fingerprint;
  } catch {
    // REASON: no readable baseline means the tree was never seen: the gate runs.
    return undefined;
  }
};

const recordBaseline = (sessionId, fingerprint) => {
  try {
    mkdirSync(dirname(baselinePath(sessionId)), { recursive: true });
    writeFileSync(baselinePath(sessionId), `${JSON.stringify({ fingerprint })}\n`);
  } catch {
    // REASON: without a baseline the next stop runs the gate, which is the safe side.
  }
};

const input = mode === "edit" ? {} : readInput();

// The gate judges what this conversation changed. A prompt records the tree as the turn
// starts, so a pull, a commit or an edit made elsewhere between turns is not handed to
// this turn. It prints nothing (a UserPromptSubmit hook's stdout reaches the model) and
// never blocks the prompt.
if (mode === "prompt") {
  const fingerprint = treeFingerprint();
  if (fingerprint !== undefined) recordBaseline(input.session_id, fingerprint);
  process.exit(0);
}

// A stop that this hook already blocked continues, so a finding the agent cannot
// close (human authority) interrupts once instead of looping.
if (input.stop_hook_active === true) process.exit(0);

// A stop over the state the turn started from (without the prompt hook: the state the
// last stop judged) ends silently, so a question changes nothing and a closed gate is
// reported once. Any change during the turn, by an edit tool, a shell or a commit, runs
// the complete gate.
const fingerprint = mode === "stop" ? treeFingerprint() : undefined;
if (fingerprint !== undefined && readBaseline(input.session_id) === fingerprint) process.exit(0);

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
  recordBaseline(input.session_id, fingerprint);
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
