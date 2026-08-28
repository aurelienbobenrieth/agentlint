/** Proposal recording handler. @module @since 0.3.0 */

import { Effect } from "effect";
import { Env } from "../../config/env.js";
import { ProposalRecord } from "../../domain/proposal.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import { collectFindingForSelector } from "../accept/handler.js";
import { ProposeCommand, ProposeResult } from "./request.js";

export const proposeHandler = Effect.fn("proposeHandler")(function* (command: ProposeCommand) {
  if (!command.selector) return new ProposeResult({ message: "Missing finding selector.", exitCode: 2 });
  if (!command.summary?.trim()) {
    return new ProposeResult({ message: 'Missing summary. Pass --summary "...".', exitCode: 2 });
  }
  const selected = yield* collectFindingForSelector(command.selector, command.base);
  if ("error" in selected) return new ProposeResult({ message: selected.error, exitCode: 2 });
  const env = yield* Env;
  const store = yield* ProposalStore;
  const finding = selected.finding;
  yield* store.upsert(
    new ProposalRecord({
      schemaVersion: 1,
      source: finding.source,
      fingerprint: finding.fingerprint,
      summary: command.summary.trim(),
      ...(command.diff?.trim() ? { diff: command.diff } : {}),
      actor: env.actor,
      proposedAt: new Date().toISOString(),
    }),
  );
  return new ProposeResult({
    message: `Recorded a proposal for ${finding.ruleId} at ${finding.file}:${finding.line}. A human decides in agentlint review.`,
    exitCode: 0,
  });
});
