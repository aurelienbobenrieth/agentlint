#!/usr/bin/env node
/**
 * Reproducible end-to-end latency probe, including CLI startup and persistence.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

const encodePrettyJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Json, { space: 2 }));

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
  for (const file of Array.from({ length: fileCount }, (_, index) => index)) {
    writeFileSync(
      join(cwd, "src", `${file}.ts`),
      Array.from({ length: callsPerFile }, (_, call) => `danger(${call});`).join("\n"),
    );
  }
  const results = [];
  /**
   * @type {ReadonlyArray<readonly [string, ReadonlyArray<string>]>}
   */
  const scenarios = [
    ["complete", ["check", "--all"]],
    ["single-file", ["check", "src/0.ts"]],
    ["complete-with-artifact", ["check", "--all", "--review-output", "review.json"]],
  ];
  for (const [name, args] of scenarios) {
    const measurements = Array.from({ length: samples }, () => {
      const started = performance.now();
      const result = spawnSync(process.execPath, [bin, ...args], {
        cwd,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (result.status !== 1) throw new Error(`${name} failed: ${result.error ?? result.stderr.toString()}`);
      return { duration: Math.round(performance.now() - started), stdoutBytes: result.stdout.byteLength };
    });
    const durations = measurements.map(({ duration }) => duration);
    const stdoutBytes = measurements.at(-1)?.stdoutBytes ?? 0;
    results.push({ name, milliseconds: durations, medianMs: durations.toSorted((a, b) => a - b)[2], stdoutBytes });
  }
  process.stdout.write(
    `${encodePrettyJson({ node: process.version, platform: process.platform, fileCount, callsPerFile, samples, results })}\n`,
  );
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
