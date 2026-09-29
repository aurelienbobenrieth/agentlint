import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const hookSource = resolve(import.meta.dirname, "../skills/agentlint/setup/agentlint-gate.mjs");
const roots: Array<string> = [];

// A consumer repository with the copied hook and a CLI whose gate is always closed.
const closedGateRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "agentlint-gate-hook-"));
  roots.push(root);
  mkdirSync(join(root, ".agentlint/hooks"), { recursive: true });
  copyFileSync(hookSource, join(root, ".agentlint/hooks/agentlint-gate.mjs"));
  const bin = join(root, "node_modules/@aurelienbbn/agentlint/dist");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "bin.mjs"), 'console.log("demo/unresolved src/app.ts:1"); process.exit(1);\n');
  return root;
};

const stop = (root: string, input: Record<string, unknown>) =>
  spawnSync(process.execPath, [join(root, ".agentlint/hooks/agentlint-gate.mjs"), "stop"], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });

const stopAfter = (entries: ReadonlyArray<unknown>) => {
  const root = closedGateRepo();
  const transcript = join(root, "transcript.jsonl");
  writeFileSync(transcript, entries.map((entry) => JSON.stringify(entry)).join("\n"));
  return stop(root, { transcript_path: transcript });
};

const claude = {
  prompt: (text: string) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }),
  edit: { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: {} }] } },
  toolResult: { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } },
  reply: { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Here is why." }] } },
  hookFeedback: { type: "user", isMeta: true, message: { role: "user", content: "Stop hook feedback: ..." } },
};

const codex = {
  turn: { type: "event_msg", payload: { type: "task_started" } },
  patch: {
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "exec",
      input: 'await tools.apply_patch("*** Begin Patch\\n*** Update File: src/app.ts\\n*** End Patch")',
    },
  },
  shell: {
    type: "response_item",
    payload: { type: "custom_tool_call", name: "exec", input: 'await tools.exec_command({ cmd: "git status" })' },
  },
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("agentlint-gate.mjs stop", () => {
  it("returns the findings with exit 2 when the current turn edited files", () => {
    const result = stopAfter([claude.prompt("Fix the bug"), claude.edit, claude.toolResult, claude.reply]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("demo/unresolved src/app.ts:1");
  });

  it("stays silent on a question asked after an earlier turn edited files", () => {
    const result = stopAfter([
      claude.prompt("Fix the bug"),
      claude.edit,
      claude.toolResult,
      claude.reply,
      claude.hookFeedback,
      claude.reply,
      claude.prompt("Why does the cache miss?"),
      claude.reply,
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it.each([
    ["hook feedback", claude.hookFeedback],
    ["a task notification", { type: "user", message: { role: "user", content: "<task-notification>done" } }],
  ])("keeps gating an editing turn after %s arrives", (_, injected) => {
    expect(
      stopAfter([claude.prompt("Fix the bug"), claude.edit, claude.toolResult, injected, claude.reply]).status,
    ).toBe(2);
  });

  it("gates a Codex turn whose exec call applied a patch", () => {
    expect(stopAfter([codex.turn, codex.shell, codex.patch]).status).toBe(2);
  });

  it("stays silent on a Codex turn that only ran commands after an editing turn", () => {
    expect(stopAfter([codex.turn, codex.patch, codex.turn, codex.shell]).status).toBe(0);
  });

  it("runs the gate when the transcript is unreadable", () => {
    const root = closedGateRepo();

    expect(stop(root, { transcript_path: join(root, "missing.jsonl") }).status).toBe(2);
  });

  it("lets a stop that the hook already blocked end", () => {
    const root = closedGateRepo();

    expect(stop(root, { stop_hook_active: true }).status).toBe(0);
  });
});
