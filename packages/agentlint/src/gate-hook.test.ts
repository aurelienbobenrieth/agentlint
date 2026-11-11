import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const hookSource = resolve(import.meta.dirname, "../skills/agentlint-setup/agentlint-gate.mjs");
const roots: Array<string> = [];

// Git never searches above the fixture, and no GIT_* variable from an outer git
// process (a commit hook running this suite) redirects it.
const env = (root: string, gate: "open" | "closed") => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CEILING_DIRECTORIES: dirname(root),
  FAKE_GATE: gate,
});

// A consumer repository with the copied hook and a CLI whose verdict comes from
// FAKE_GATE, so a silent stop after the verdict flips proves the CLI did not run.
const consumerRepo = ({ git }: { readonly git: boolean }) => {
  const root = mkdtempSync(join(tmpdir(), "agentlint-gate-hook-"));
  roots.push(root);
  mkdirSync(join(root, ".agentlint/hooks"), { recursive: true });
  copyFileSync(hookSource, join(root, ".agentlint/hooks/agentlint-gate.mjs"));
  const bin = join(root, "node_modules/@aurelienbbn/agentlint/dist");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "bin.mjs"),
    'if (process.env.FAKE_GATE === "closed") { console.log("demo/unresolved src/app.ts:1"); process.exit(1); }\n',
  );
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/app.ts"), "export const a = 1;\n");
  // The fixture leaves .agentlint/.cache/ unignored: the hook's own state must not count as a change.
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  if (git) {
    const run = (...args: Array<string>) =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
        cwd: root,
        env: env(root, "open"),
      });
    run("init", "-q");
    run("add", ".");
    run("commit", "-qm", "init");
  }
  return root;
};

const stop = (root: string, gate: "open" | "closed", input: Record<string, unknown> = {}) =>
  spawnSync(process.execPath, [join(root, ".agentlint/hooks/agentlint-gate.mjs"), "stop"], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: env(root, gate),
  });

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("agentlint-gate.mjs stop", () => {
  it("returns the findings with exit 2 when the gate is closed", () => {
    const result = stop(consumerRepo({ git: true }), "closed");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("demo/unresolved src/app.ts:1");
  });

  it("stays silent while the working tree is unchanged", () => {
    const root = consumerRepo({ git: true });

    expect(stop(root, "open").status).toBe(0);
    const result = stop(root, "closed");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it.each([
    ["a tracked file changed outside an edit tool", "src/app.ts"],
    ["a new untracked file", "src/new.ts"],
  ])("runs the gate after %s", (_, path) => {
    const root = consumerRepo({ git: true });
    expect(stop(root, "open").status).toBe(0);

    writeFileSync(join(root, path), "export const b = 2;\n");

    expect(stop(root, "closed").status).toBe(2);
  });

  it.each([
    ["a tracked file", "src/app.ts"],
    ["an untracked file in a new directory", "src/feature/new.ts"],
  ])("runs the gate again after a second change to %s", (_, path) => {
    const root = consumerRepo({ git: true });
    mkdirSync(join(root, "src/feature"));
    writeFileSync(join(root, path), "export const a = 2;\n");
    expect(stop(root, "open").status).toBe(0);

    writeFileSync(join(root, path), "export const a = 3;\n");

    expect(stop(root, "closed").status).toBe(2);
  });

  it("reports a closed gate once, then stays silent while nothing changes", () => {
    const root = consumerRepo({ git: true });

    expect(stop(root, "closed").status).toBe(2);
    expect(stop(root, "closed", { stop_hook_active: true }).status).toBe(0);
    const later = stop(root, "closed");

    expect(later.status).toBe(0);
    expect(later.stderr).toBe("");
  });

  it("runs the gate on every stop without git", () => {
    const root = consumerRepo({ git: false });

    expect(stop(root, "closed").status).toBe(2);
    expect(stop(root, "closed").status).toBe(2);
  });

  it("lets a stop that the hook already blocked end", () => {
    expect(stop(consumerRepo({ git: true }), "closed", { stop_hook_active: true }).status).toBe(0);
  });
});
