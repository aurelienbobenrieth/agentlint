/**
 * Human approval of a finding.
 *
 * `approve` is the only path that records an `approved` disposition. It is
 * reserved for human actors: the guard is accountability, not security —
 * an agent can technically pass `--actor`, but the forged actor is then a
 * visible, committed ledger line that PR review catches.
 *
 * @module
 * @since 0.2.0
 */

import { Effect } from "effect";
import { Env } from "../../config/env.js";
import { normalizeConfig, policyForRule } from "../../domain/config.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { LedgerRecord, LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { resolveFindingSelector } from "../../shared/pipeline/selectors.js";
import { collectFindingsForSelector } from "../resolve/handler.js";
import { ApproveCommand, ApproveResult } from "./request.js";

export const approveHandler = Effect.fn("approveHandler")(function* (command: ApproveCommand) {
  const env = yield* Env;
  const configLoader = yield* ConfigLoader;
  const ledgerStore = yield* LedgerStore;

  if (!command.selector) {
    return new ApproveResult({ message: 'Usage: agentlint approve <selector> --reason "..."', exitCode: 2 });
  }
  if (!command.reason || command.reason.trim().length === 0) {
    return new ApproveResult({ message: 'Missing reason. Pass --reason "...".', exitCode: 2 });
  }

  const actor = command.actor ?? env.actor;
  if (actor.startsWith("agent:")) {
    return new ApproveResult({
      message: [
        "approve is reserved for humans.",
        `Agents request approval instead: agentlint resolve ${command.selector} --request-approval --reason "..."`,
      ].join("\n"),
      exitCode: 2,
    });
  }

  const config = normalizeConfig(yield* configLoader.load());
  const { findings, cache } = yield* collectFindingsForSelector(command.selector);
  const resolution = resolveFindingSelector(command.selector, findings, cache);
  if (!resolution.ok) {
    return new ApproveResult({ message: resolution.message, exitCode: 2 });
  }

  const finding = resolution.finding;
  const policy = policyForRule(config, finding.ruleId);
  const record = new LedgerRecord({
    version: 1,
    persistence: policy.persistence === "durable" ? "durable" : undefined,
    ruleId: finding.ruleId,
    hash: finding.hash,
    status: "approved",
    reason: command.reason.trim(),
    actor,
    at: new Date().toISOString(),
    summary: undefined,
    adr: undefined,
  });

  const result = yield* ledgerStore.append(record);
  return new ApproveResult({
    message: result.appended
      ? `Approved ${finding.ruleId} ${finding.file}:${finding.line}. The approval stays valid while the code is unchanged.`
      : `Approval already recorded for ${finding.ruleId} ${finding.file}:${finding.line}.`,
    exitCode: 0,
  });
});
