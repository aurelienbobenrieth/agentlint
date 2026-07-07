#!/usr/bin/env node

/**
 * Render `agentlint ledger review --format jsonl` output as a PR comment body.
 *
 * Usage: node render-ledger-review.mjs <jsonl-file> <base-ref>
 */

import { readFileSync } from "node:fs";
import { Schema } from "effect";

const PendingLine = Schema.Struct({
  type: Schema.Literal("pending_approval"),
  ruleId: Schema.String,
  hash: Schema.String,
  file: Schema.String,
  line: Schema.Number,
  message: Schema.String,
  reason: Schema.String,
  actor: Schema.String,
  at: Schema.String,
});

const DispositionLine = Schema.Struct({
  type: Schema.Literal("disposition"),
  ruleId: Schema.String,
  hash: Schema.String,
  status: Schema.String,
  reason: Schema.String,
  actor: Schema.String,
  at: Schema.String,
});

const ReviewLine = Schema.Union([PendingLine, DispositionLine]);
const ReviewLineFromString = Schema.decodeUnknownSync(Schema.fromJsonString(ReviewLine));

const [, , jsonlPath, baseRef = "main"] = process.argv;
const content = jsonlPath ? readFileSync(jsonlPath, "utf8") : "";

const lines = content
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .map((line) => ReviewLineFromString(line));

const pending = lines.filter((line) => line.type === "pending_approval");
const dispositions = lines.filter((line) => line.type === "disposition");

const escape = (text) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

const out = ["<!-- agentlint-ledger-review -->", "## agentlint ledger review", ""];

out.push(`### Pending human approval (${pending.length})`, "");
if (pending.length === 0) {
  out.push("_None - nothing is waiting on a human._", "");
} else {
  out.push("| Rule | Location | Requested by | Reason |", "| --- | --- | --- | --- |");
  for (const item of pending) {
    out.push(
      `| \`${item.ruleId}\` [\`${item.hash}\`] | \`${item.file}:${item.line}\` | \`${escape(item.actor)}\` | ${escape(item.reason)} |`,
    );
  }
  out.push(
    "",
    'Approve locally with `pnpm agentlint review` (UI) or `pnpm agentlint approve <hash> --reason "..."`. Pending requests block `check --ci`.',
    "",
  );
}

out.push(`### New dispositions since \`${baseRef}\` (${dispositions.length})`, "");
if (dispositions.length === 0) {
  out.push("_None._", "");
} else {
  out.push("| Status | Rule | Actor | Reason |", "| --- | --- | --- | --- |");
  for (const item of dispositions) {
    out.push(
      `| ${item.status} | \`${item.ruleId}\` [\`${item.hash}\`] | \`${escape(item.actor)}\` | ${escape(item.reason)} |`,
    );
  }
  out.push("");
}

out.push("_Dispositions are hash-pinned: editing the flagged code invalidates them automatically._");

process.stdout.write(out.join("\n") + "\n");
