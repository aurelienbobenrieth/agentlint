#!/usr/bin/env node
/** Reproducible end-to-end latency probe, including CLI startup and persistence. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../packages/agentlint/dist/bin.mjs", import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), "agentlint-benchmark-"));
const fileCount = 100;
const callsPerFile = 10;
const samples = 5;

try {
  mkdirSync(join(cwd, ".agentlint"));
  mkdirSync(join(cwd, "src"));
  writeFileSync(
    join(cwd, ".agentlint", "config.ts"),
    `
import { defineConfig, defineRule } from "@aurelienbbn/agentlint";
export default defineConfig({ rules: [defineRule({
  lifecycle: "state",
  standard: { id: "review", revision: 1, title: "Review", guidance: "Review the call." },
  detector: { id: "danger", version: 1, match: { pattern: "danger($ARG)", message: "Review" } },
  binding: { id: "review", authority: "agent", include: ["src/**/*.ts"] }
})] });
`,
  );
  for (let file = 0; file < fileCount; file++) {
    writeFileSync(
      join(cwd, "src", `${file}.ts`),
      Array.from({ length: callsPerFile }, (_, call) => `danger(${call});`).join("\n"),
    );
  }
  const results = [];
  for (const [name, args] of [
    ["complete", ["check", "--all"]],
    ["single-file", ["check", "src/0.ts"]],
    ["complete-with-artifact", ["check", "--all", "--review-output", "review.json"]],
  ]) {
    const durations = [];
    let stdoutBytes = 0;
    for (let sample = 0; sample < samples; sample++) {
      const started = performance.now();
      const result = spawnSync(process.execPath, [bin, ...args], {
        cwd,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (result.status !== 1) throw new Error(`${name} failed: ${result.error ?? result.stderr?.toString()}`);
      durations.push(Math.round(performance.now() - started));
      stdoutBytes = result.stdout.byteLength;
    }
    results.push({ name, milliseconds: durations, medianMs: durations.toSorted((a, b) => a - b)[2], stdoutBytes });
  }
  process.stdout.write(
    `${JSON.stringify({ node: process.version, platform: process.platform, fileCount, callsPerFile, samples, results }, null, 2)}\n`,
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
