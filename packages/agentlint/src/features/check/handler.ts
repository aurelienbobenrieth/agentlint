/**
 * Check application handler. @module @since 0.2.0
 */

import { Array as A, Effect } from "effect";
import { findLineage, lookupAcceptance } from "../../domain/acceptance.js";
import { findingId, findingKey, withSelector, type FindingRecord } from "../../domain/finding.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { CheckCommand, CheckResult } from "./request.js";

export const checkHandler = Effect.fn("checkHandler")(function* (command: CheckCommand, updateSelectorCache = true) {
  const store = yield* AcceptanceStore;
  const selectors = yield* SelectorCache;
  const proposals = yield* ProposalStore;
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
    if (lookupAcceptance({ acceptances: snapshot, finding })) accepted.push(finding);
    else unresolved.push(finding);
  }
  const staleCount =
    collected.scope === "complete" ? A.filter([...snapshot.byKey.keys()], (key) => !currentKeys.has(key)).length : 0;
  const selected = A.map(unresolved, (finding, index) =>
    withSelector({
      finding,
      selector: collected.scope === "complete" ? String(index + 1) : findingId(finding).slice(0, 12),
    }),
  );
  const lineage = A.flatMap(unresolved, (finding) => {
    const prior = findLineage({ records: snapshot.records, finding });
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

  if (updateSelectorCache && collected.scope === "complete") {
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
  }

  if (collected.scope === "complete" && staleCount > 0) {
    yield* store.reconcile({ scope: "complete", current: collected.findings });
  }
  // A proposal describes one exact finding. Once a complete view no longer contains it, nobody can decide on it.
  if (collected.scope === "complete") {
    yield* proposals.prune(collected.findings);
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
