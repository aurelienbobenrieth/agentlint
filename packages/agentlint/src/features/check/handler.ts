/**
 * Check application handler. @module @since 0.2.0
 */

import { Array as A, Effect } from "effect";
import { findLineage, legacyKeys, lookupAcceptance, staleScopeCovers } from "../../domain/acceptance.js";
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
      migratedCount: 0,
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
  const previousKeys = new Set<string>();
  for (const finding of collected.findings) {
    currentKeys.add(findingKey(finding));
    for (const key of legacyKeys(finding)) previousKeys.add(key);
    if (lookupAcceptance({ acceptances: snapshot, finding })) accepted.push(finding);
    else unresolved.push(finding);
  }
  // A decision stored under a legacy fingerprint of a current finding is not stale: the reconcile below re-keys it.
  const staleCount = A.filter(
    [...snapshot.byKey],
    ([key, record]) =>
      !currentKeys.has(key) && !previousKeys.has(key) && staleScopeCovers({ scope: collected.stale, record }),
  ).length;
  // Only state findings carry legacy fingerprints, and every scan that may remove records sees all of them.
  const migratable = collected.stale !== "none" && A.some([...snapshot.byKey.keys()], (key) => previousKeys.has(key));
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

  const reconciled =
    staleCount > 0 || migratable
      ? yield* store.reconcile({ stale: collected.stale, current: collected.findings })
      : undefined;
  // A proposal describes one exact finding. Once a view that could find it no longer does, nobody can decide on it.
  if (collected.stale !== "none") {
    yield* proposals.prune({ stale: collected.stale, current: collected.findings });
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
    migratedCount: reconciled?.migrated.length ?? 0,
    scope: collected.scope,
    base: collected.base,
    exitCode: selected.length > 0 ? 1 : 0,
    noMatchingRules: false,
    availableRules: [...collected.availableRules],
  });
});
