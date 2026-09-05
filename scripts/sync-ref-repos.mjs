#!/usr/bin/env node

/**
 * Create or refresh the gitignored reference clones under `.agents/ref-repos/`.
 *
 * Each clone is shallow and always points at the upstream default branch. The
 * list is the source of truth; the clones themselves are never committed.
 *
 *   node scripts/sync-ref-repos.mjs            # sync every repo
 *   node scripts/sync-ref-repos.mjs effect oxc # sync a subset
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const REPOS = [
  { name: "effect", url: "https://github.com/Effect-TS/effect.git" },
  { name: "eslint", url: "https://github.com/eslint/eslint.git" },
  { name: "executor", url: "https://github.com/UsefulSoftwareCo/executor.git" },
  { name: "foldkit", url: "https://github.com/foldkit/foldkit.git" },
  { name: "oxc", url: "https://github.com/oxc-project/oxc.git" },
  { name: "t3code", url: "https://github.com/pingdotgg/t3code.git" },
];

const root = resolve(import.meta.dirname, "..", ".agents", "ref-repos");
const selected = new Set(process.argv.slice(2));
const unknown = [...selected].filter((name) => !REPOS.some((repo) => repo.name === name));
if (unknown.length) {
  console.error(`Unknown reference repo(s): ${unknown.join(", ")}. Known: ${REPOS.map((r) => r.name).join(", ")}`);
  process.exit(2);
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
  return result.stdout.trim();
}

mkdirSync(root, { recursive: true });
for (const repo of REPOS) {
  if (selected.size && !selected.has(repo.name)) continue;
  const dir = join(root, repo.name);
  if (existsSync(join(dir, ".git"))) {
    git(["fetch", "--quiet", "--depth=1", "origin", "HEAD"], dir);
    git(["reset", "--quiet", "--hard", "FETCH_HEAD"], dir);
  } else {
    git(["clone", "--quiet", "--depth=1", repo.url, dir], root);
  }
  console.log(`${repo.name.padEnd(9)} ${git(["log", "-1", "--format=%h %cs %s"], dir)}`);
}
