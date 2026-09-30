#!/usr/bin/env node
/**
 * Reproducible end-to-end latency probe, including CLI startup and persistence.
 *
 * `node scripts/benchmark.mjs [--changed <files>] [--bin <path to bin.mjs>]` builds two throwaway projects: a plain
 * directory scanned by a state rule, and a Git repository whose branch changes `--changed` files (default 400) against
 * `main`, read by a state and a change rule. Each scenario reports wall-clock samples and how many Git processes one
 * run started: that count stays flat as the change grows, so a per-file Git call shows up as a number, not as noise.
 * `--bin` measures another build, such as a copy of `packages/agentlint/dist` taken before a change.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Schema } from "effect";

const encodePrettyJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Json, { space: 2 }));

const { values } = parseArgs({
  options: { changed: { type: "string", default: "400" }, bin: { type: "string" } },
});
const changedFiles = Number(values.changed);
const bin = resolve(values.bin ?? fileURLToPath(new URL("../packages/agentlint/dist/bin.mjs", import.meta.url)));
const root = mkdtempSync(join(tmpdir(), "agentlint-benchmark-"));
const fileCount = 100;
const callsPerFile = 10;
const samples = 5;

/**
 * Preloaded into the CLI: counts the Git processes it starts and writes the count when it exits.
 */
const counter = join(root, "count-git.mjs");
writeFileSync(
  counter,
  `
import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const count = { git: 0 };
for (const name of ["execFile", "spawn"]) {
  const original = childProcess[name];
  childProcess[name] = function (file, ...rest) {
    if (file === "git") count.git += 1;
    return original.call(this, file, ...rest);
  };
}
syncBuiltinESMExports();
process.on("exit", () => writeFileSync(process.env.AGENTLINT_BENCHMARK_COUNT, String(count.git)));
`,
);

const rule = (lifecycle) =>
  lifecycle === "state"
    ? `defineRule({
  lifecycle: "state",
  standard: { id: "review", revision: 1, title: "Review", guidance: "Review the call." },
  detector: { id: "danger", version: 1, match: { pattern: "danger($ARG)", message: "Review" } },
  binding: { id: "review", authority: "agent", include: ["src/**/*.ts"] }
})`
    : `defineRule({
  lifecycle: "change",
  standard: { id: "changes", revision: 1, title: "Changes", guidance: "Review the change." },
  detector: {
    id: "every-change",
    version: 1,
    detect({ context }) {
      for (const changed of context.change.files)
        context.report({ key: changed.path, file: changed.path, message: "Review", evidence: changed.after?.digest ?? null });
    },
  },
  binding: { id: "changes", authority: "agent", include: ["src/**/*.ts"] }
})`;

const config = (lifecycles) =>
  `import { defineConfig, defineRule } from "@aurelienbbn/agentlint";
export default defineConfig({ base: "main", rules: [${lifecycles.map(rule).join(", ")}] });
`;

const source = (index, calls) =>
  `${Array.from({ length: calls }, (_, call) => `danger(${call});`).join("\n")}\nexport const file${index} = ${index};\n`;

/**
 * A directory without Git, scanned whole.
 */
const plainProject = () => {
  const cwd = join(root, "plain");
  mkdirSync(join(cwd, ".agentlint"), { recursive: true });
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, ".agentlint", "config.ts"), config(["state"]));
  for (const file of Array.from({ length: fileCount }, (_, index) => index))
    writeFileSync(join(cwd, "src", `${file}.ts`), source(file, callsPerFile));
  return cwd;
};

/**
 * `main` holds the baseline; the working tree modifies, adds, deletes, and renames files against it, committed, staged,
 * and untracked.
 */
const changedRepository = () => {
  const cwd = join(root, "changed");
  mkdirSync(join(cwd, ".agentlint"), { recursive: true });
  mkdirSync(join(cwd, "src"));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Benchmark",
        "-c",
        "user.email=benchmark@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, stdio: "pipe", windowsHide: true },
    );
  git("init", "-q", "-b", "main");
  writeFileSync(join(cwd, ".agentlint", "config.ts"), config(["state", "change"]));
  const baseline = Math.ceil(changedFiles / 2);
  for (const index of Array.from({ length: baseline + 10 }, (_, value) => value))
    writeFileSync(join(cwd, "src", `kept-${index}.ts`), source(index, 3));
  git("add", "-A");
  git("commit", "-q", "-m", "baseline");
  git("checkout", "-q", "-b", "feature");
  for (const index of Array.from({ length: baseline }, (_, value) => value))
    writeFileSync(join(cwd, "src", `kept-${index}.ts`), source(index, 4));
  for (const index of Array.from({ length: changedFiles - baseline }, (_, value) => value))
    writeFileSync(join(cwd, "src", `added-${index}.ts`), source(index, 2));
  git("add", "-A");
  git("commit", "-q", "-m", "change");
  git("mv", join("src", `kept-${baseline}.ts`), join("src", "renamed.ts"));
  rmSync(join(cwd, "src", `kept-${baseline + 1}.ts`));
  writeFileSync(join(cwd, "src", "untracked.ts"), source(0, 1));
  return cwd;
};

const measure = ({ name, cwd, args }) => {
  const countFile = join(root, "git-count");
  const measurements = Array.from({ length: samples }, () => {
    const started = performance.now();
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(counter).href, bin, ...args], {
      cwd,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, AGENTLINT_BENCHMARK_COUNT: countFile },
    });
    if (result.status !== 1) throw new Error(`${name} failed: ${result.error ?? result.stderr.toString()}`);
    return {
      duration: Math.round(performance.now() - started),
      stdoutBytes: result.stdout.byteLength,
      gitProcesses: Number(readFileSync(countFile, "utf8")),
    };
  });
  const durations = measurements.map(({ duration }) => duration);
  const last = measurements.at(-1);
  return {
    name,
    milliseconds: durations,
    medianMs: durations.toSorted((a, b) => a - b)[Math.floor(samples / 2)],
    stdoutBytes: last?.stdoutBytes ?? 0,
    gitProcesses: last?.gitProcesses ?? 0,
  };
};

try {
  const plain = plainProject();
  const changed = changedRepository();
  const results = [
    measure({ name: "complete", cwd: plain, args: ["check", "--all"] }),
    measure({ name: "single-file", cwd: plain, args: ["check", "src/0.ts"] }),
    measure({ name: "complete-with-artifact", cwd: plain, args: ["check", "--all", "--review-output", "review.json"] }),
    measure({ name: "changed-repository", cwd: changed, args: ["check", "--all"] }),
    measure({ name: "changed-files-only", cwd: changed, args: ["check"] }),
  ];
  process.stdout.write(
    `${encodePrettyJson({ node: process.version, platform: process.platform, fileCount, callsPerFile, changedFiles, samples, results })}\n`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
