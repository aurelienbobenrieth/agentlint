import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const worker = fileURLToPath(new URL("../../../../__fixtures__/file-lock-process.mjs", import.meta.url));
const processes = new Set<ChildProcessWithoutNullStreams>();
const directories = new Set<string>();

function start(directory: string, lock: string, hold: number): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, ["--experimental-strip-types", worker, directory, lock, String(hold)], {
    stdio: "pipe",
    windowsHide: true,
  });
  processes.add(child);
  child.once("exit", () => processes.delete(child));
  return child;
}

function output(child: ChildProcessWithoutNullStreams): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += String(chunk)));
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function acquired(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("The lock worker did not acquire the lock.")), 5_000);
    const onData = (chunk: Buffer) => {
      if (!String(chunk).includes("ACQUIRED")) return;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      resolve();
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`The lock worker exited before acquisition (${String(code)}).`));
    });
  });
}

afterEach(() => {
  for (const child of processes) child.kill();
  processes.clear();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

describe("cross-process file lock", () => {
  it("waits for a slow owner that releases within the wait budget", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentlint-process-lock-"));
    directories.add(directory);
    const lock = join(directory, "store.lock");

    const owner = start(directory, lock, 4_000);
    const ownerResult = output(owner);
    await acquired(owner);

    const contender = await output(start(directory, lock, 0));
    expect(await ownerResult).toMatchObject({ code: 0 });
    expect(contender).toMatchObject({ code: 0, stdout: "ACQUIRED\nRELEASED\n" });
    expect(existsSync(lock)).toBe(false);
  }, 20_000);

  it("fails closed after an owner is interrupted and recovers only after explicit cleanup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentlint-process-lock-"));
    directories.add(directory);
    const lock = join(directory, "store.lock");

    const owner = start(directory, lock, 30_000);
    await acquired(owner);
    expect(existsSync(lock)).toBe(true);

    const contender = await output(start(directory, lock, 0));
    expect(contender.code).toBe(2);
    expect(contender.stderr).toContain("The store is locked");

    owner.kill();
    await new Promise<void>((resolve) => owner.once("exit", () => resolve()));
    expect(existsSync(lock)).toBe(true);

    const staleRetry = await output(start(directory, lock, 0));
    expect(staleRetry.code).toBe(2);
    expect(staleRetry.stderr).toContain("remove this file and retry");

    rmSync(lock);
    const recovered = await output(start(directory, lock, 10));
    expect(recovered).toMatchObject({ code: 0, stdout: "ACQUIRED\nRELEASED\n" });
    expect(existsSync(lock)).toBe(false);
  }, 45_000);
});
