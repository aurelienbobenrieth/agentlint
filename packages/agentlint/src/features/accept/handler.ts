/** Acceptance application handler. @module @since 0.2.0 */

import { Effect } from "effect";
import { Env } from "../../config/env.js";
import { AcceptanceRecord, authoritySatisfies } from "../../domain/acceptance.js";
import { findingKey } from "../../domain/finding.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { resolveFindingSelector } from "../../shared/pipeline/selectors.js";
import { AcceptCommand, AcceptResult } from "./request.js";

export const collectFindingForSelector = Effect.fn("collectFindingForSelector")(function* (
  selector: string,
  base?: string,
) {
  const selectorStore = yield* SelectorCache;
  const cache = yield* selectorStore.read();
  const normalized = selector.trim().replace(/^\[(\d+)\]$/, "$1");
  const entry = cache.findings.find((candidate) => candidate.selector === normalized || candidate.hash === normalized);

  if (entry) {
    const targeted = yield* collectFindings({
      all: false,
      rules: [entry.ruleId],
      base,
      files: [entry.file],
    });
    const exact = targeted.findings.find((finding) => findingKey(finding) === entry.hash);
    if (exact) return { finding: exact, cache } as const;
  }

  const complete = yield* collectFindings({ all: true, rules: [], base, files: [] });
  const resolution = resolveFindingSelector(selector, complete.findings, cache);
  return resolution.ok
    ? ({ finding: resolution.finding, cache } as const)
    : ({ error: resolution.message, cache } as const);
});

export const acceptFinding = Effect.fn("acceptFinding")(function* (
  finding: Parameters<typeof findingKey>[0] & {
    readonly authority: "agent" | "human";
    readonly lineageKey?: string | undefined;
    readonly ruleId: string;
    readonly file: string;
    readonly line: number;
  },
  input: { readonly authority: "agent" | "human"; readonly reason: string; readonly actor?: string | undefined },
) {
  const env = yield* Env;
  const store = yield* AcceptanceStore;
  if (!authoritySatisfies(input.authority, finding.authority)) {
    return new AcceptResult({
      message: `${finding.ruleId} requires human acceptance. Open agentlint review or run agentlint approve as a human.`,
      exitCode: 2,
    });
  }
  const record = new AcceptanceRecord({
    schemaVersion: 1,
    source: finding.source,
    fingerprint: finding.fingerprint,
    lineageKey: finding.lineageKey,
    reason: input.reason.trim(),
    authority: input.authority,
    actor: input.actor ?? env.actor,
    acceptedAt: new Date().toISOString(),
  });
  yield* store.reconcile({ scope: "partial", current: [finding], accepted: [record] });
  return new AcceptResult({
    message: `Accepted ${finding.ruleId} at ${finding.file}:${finding.line}.`,
    exitCode: 0,
  });
});

export const acceptHandler = Effect.fn("acceptHandler")(function* (command: AcceptCommand) {
  if (!command.selector) return new AcceptResult({ message: "Missing finding selector.", exitCode: 2 });
  if (!command.reason?.trim())
    return new AcceptResult({ message: 'Missing reason. Pass --reason "...".', exitCode: 2 });
  const selected = yield* collectFindingForSelector(command.selector, command.base);
  if ("error" in selected) return new AcceptResult({ message: selected.error, exitCode: 2 });
  return yield* acceptFinding(selected.finding, { authority: command.authority, reason: command.reason });
});
