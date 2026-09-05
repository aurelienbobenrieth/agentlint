/** Check application handler. @module @since 0.2.0 */

import { Effect } from "effect";
import { findLineage } from "../../domain/acceptance.js";
import { findingKey, withSelector, type FindingRecord } from "../../domain/finding.js";
import { AcceptanceStore, lookupAcceptance } from "../../shared/infrastructure/acceptance-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { CheckCommand, CheckResult } from "./request.js";

export const checkHandler = Effect.fn("checkHandler")(function* (command: CheckCommand) {
  const store = yield* AcceptanceStore;
  const selectors = yield* SelectorCache;
  const collected = yield* collectFindings(command);

  if (collected.noMatchingRules) {
    return new CheckResult({
      findings: [],
      sources: {},
      scannedFiles: [],
      acceptances: [],
      unresolved: [],
      accepted: [],
      lineage: [],
      staleCount: 0,
      scope: collected.scope,
      base: collected.base,
      exitCode: 2,
      noMatchingRules: true,
      availableRules: [...collected.availableRules],
    });
  }

  const snapshot = yield* store.read();
  const unresolved: FindingRecord[] = [];
  const accepted: FindingRecord[] = [];
  const currentKeys = new Set<string>();
  for (const finding of collected.findings) {
    currentKeys.add(findingKey(finding));
    if (lookupAcceptance(snapshot, finding)) accepted.push(finding);
    else unresolved.push(finding);
  }
  const staleCount =
    collected.scope === "complete" ? [...snapshot.byKey.keys()].filter((key) => !currentKeys.has(key)).length : 0;
  const selected = unresolved.map((finding, index) => withSelector(finding, String(index + 1)));
  const lineage = unresolved.flatMap((finding) => {
    const prior = findLineage(snapshot.records, finding);
    return prior
      ? [
          {
            findingKey: findingKey(finding),
            reason: prior.reason,
            authority: prior.authority,
            acceptedAt: prior.acceptedAt,
          },
        ]
      : [];
  });

  yield* selectors.write(
    selected.map((finding) => ({
      selector: finding.selector ?? "",
      hash: findingKey(finding),
      ruleId: finding.ruleId,
      file: finding.file,
      line: finding.line,
      column: finding.column,
    })),
  );

  if (collected.scope === "complete" && staleCount > 0) {
    yield* store.reconcile({ scope: "complete", current: collected.findings });
  }

  return new CheckResult({
    findings: [...collected.findings],
    sources: collected.sources,
    scannedFiles: [...collected.scannedFiles],
    acceptances: [...snapshot.records],
    unresolved: selected,
    accepted,
    lineage,
    staleCount,
    scope: collected.scope,
    base: collected.base,
    exitCode: selected.length > 0 ? 1 : 0,
    noMatchingRules: false,
    availableRules: [...collected.availableRules],
  });
});
