/** Acceptance maintenance handler. @module @since 0.2.0 */

import { Effect } from "effect";
import {
  AcceptanceRecord,
  acceptanceKey,
  acceptanceSatisfies,
  type AcceptanceImport,
} from "../../domain/acceptance.js";
import { findingKey } from "../../domain/finding.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { AcceptancesCommand, AcceptancesResult } from "./request.js";

/**
 * Import is all-or-nothing: either every decision identifies a current finding
 * with sufficient authority and all are written, or none are and
 * `rejectedCount` reports how many did not qualify.
 */
export const acceptancesHandler = Effect.fn("acceptancesHandler")(function* (command: AcceptancesCommand) {
  const store = yield* AcceptanceStore;
  if (command.action === "list") {
    const snapshot = yield* store.read();
    return new AcceptancesResult({
      records: [...snapshot.records],
      removedCount: 0,
      importedCount: 0,
      rejectedCount: 0,
      exitCode: 0,
    });
  }

  const collected = yield* collectFindings({ all: true, rules: [], base: command.base, files: [] });
  if (command.action === "import") {
    const snapshot = yield* store.read();
    const findingsByKey = new Map(collected.findings.map((finding) => [findingKey(finding), finding]));
    const rejectedCount = command.imported.filter((record) => {
      const finding = findingsByKey.get(acceptanceKey(record));
      if (finding === undefined || collected.sources[finding.file] !== record.reviewedSource) return true;
      if (record.type === "revoke") {
        const existing = snapshot.byKey.get(acceptanceKey(record));
        return (
          existing === undefined ||
          existing.acceptedAt !== record.expectedAcceptedAt ||
          existing.reason !== record.expectedReason
        );
      }
      return !acceptanceSatisfies(importedAcceptance(record), finding);
    }).length;
    if (rejectedCount > 0) {
      return new AcceptancesResult({
        records: [...snapshot.records],
        removedCount: 0,
        importedCount: 0,
        rejectedCount,
        exitCode: 2,
      });
    }
    const result = yield* store.reconcile({
      scope: "partial",
      current: collected.findings,
      accepted: command.imported
        .filter((record): record is AcceptanceImport => record.type === "accept")
        .map(importedAcceptance),
      revoked: command.imported.filter((record) => record.type === "revoke"),
    });
    return new AcceptancesResult({
      records: [...result.records],
      removedCount: result.removed.length,
      importedCount: command.imported.length,
      rejectedCount: 0,
      exitCode: 0,
    });
  }
  const result = yield* store.reconcile({ scope: "complete", current: collected.findings });
  return new AcceptancesResult({
    records: [...result.records],
    removedCount: result.removed.length,
    importedCount: 0,
    rejectedCount: 0,
    exitCode: 0,
  });
});

function importedAcceptance(decision: AcceptanceImport): AcceptanceRecord {
  return new AcceptanceRecord({
    schemaVersion: decision.schemaVersion,
    source: decision.source,
    fingerprint: decision.fingerprint,
    lineageKey: decision.lineageKey,
    reason: decision.reason,
    authority: decision.authority,
    actor: decision.actor,
    acceptedAt: decision.acceptedAt,
  });
}
