/**
 * Record and summarize delayed review outcomes. @module @since 0.2.0
 */
import { Clock, Effect } from "effect";
import { Env } from "../../config/env.js";
import { OutcomeRecord } from "../../domain/outcome.js";
import { OutcomeStore } from "../../shared/infrastructure/outcome-store.js";
import { collectFindingForSelector } from "../accept/handler.js";
import { OutcomeResult, RecordOutcomeCommand } from "./request.js";

export const recordOutcomeHandler = Effect.fn("recordOutcomeHandler")(function* (command: RecordOutcomeCommand) {
  if (!command.selector) return new OutcomeResult({ message: "Missing finding selector.", records: [], exitCode: 2 });
  if (!command.reference?.trim())
    return new OutcomeResult({ message: 'Missing reference. Pass --reference "...".', records: [], exitCode: 2 });
  if (!command.note?.trim())
    return new OutcomeResult({ message: 'Missing note. Pass --note "...".', records: [], exitCode: 2 });
  const selected = yield* collectFindingForSelector(command.selector, command.base);
  if ("error" in selected) return new OutcomeResult({ message: selected.error, records: [], exitCode: 2 });
  const env = yield* Env;
  const finding = selected.finding;
  const records = yield* (yield* OutcomeStore).upsert(
    new OutcomeRecord({
      schemaVersion: 1,
      source: finding.source,
      fingerprint: finding.fingerprint,
      lineageKey: finding.lineageKey,
      ruleId: finding.ruleId,
      file: finding.file,
      kind: command.kind,
      reference: command.reference.trim(),
      note: command.note.trim(),
      actor: env.actor,
      recordedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    }),
  );
  return new OutcomeResult({
    message: `Recorded ${command.kind} for ${finding.ruleId} at ${finding.file}:${finding.line}.`,
    records: [...records],
    exitCode: 0,
  });
});

export const listOutcomesHandler = Effect.fn("listOutcomesHandler")(function* () {
  const records = yield* (yield* OutcomeStore).read();
  return new OutcomeResult({ message: "", records: [...records], exitCode: 0 });
});
