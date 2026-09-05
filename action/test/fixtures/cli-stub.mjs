// @ts-check
/**
 * Scripted stand-in for the agentlint CLI, selected through
 * `AGENTLINT_ACTION_CLI_STUB`. `check` writes the fixture artifact and exits 1;
 * `approve` appends an acceptance and exits 0 unless the selector is
 * `deadbeef0`. Every invocation's argv is appended to `AGENTLINT_STUB_LOG`.
 */

import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const log = process.env["AGENTLINT_STUB_LOG"];
if (log) appendFileSync(log, `${JSON.stringify({ args, actor: process.env["AGENTLINT_ACTOR"] ?? null })}\n`);

const [command] = args;
if (command === "check") {
  const output = args[args.indexOf("--review-output") + 1];
  if (!output) throw new Error("stub: --review-output missing");
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "artifact.json"), output);
  process.stdout.write("3 unresolved findings — gate closed\n");
  process.exitCode = 1;
} else if (command === "approve") {
  const selector = args[1];
  if (selector === "deadbeef0") {
    process.stdout.write(`No current finding matches "${selector}". Rerun agentlint check if the selector is stale.\n`);
    process.exitCode = 2;
  } else {
    mkdirSync(".agentlint", { recursive: true });
    appendFileSync(".agentlint/acceptances.jsonl", `${JSON.stringify({ stub: true, selector })}\n`);
    process.stdout.write("Accepted security/dynamic-code-execution at src/vendor/legacy-parser.js:3.\n");
  }
} else {
  process.stderr.write(`stub: unknown command ${command}\n`);
  process.exitCode = 2;
}
