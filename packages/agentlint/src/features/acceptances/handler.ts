/**
 * Acceptance maintenance handler. @module @since 0.2.0
 */

import { Effect } from "effect";
import {
  AcceptanceRecord,
  acceptanceKey,
  acceptanceSatisfies,
  findStoredAcceptance,
  legacyKeys,
  rekeyedAcceptance,
  type AcceptanceImport,
} from "../../domain/acceptance.js";
import { findingKey, type FindingRecord } from "../../domain/finding.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { AcceptancesCommand, AcceptancesResult } from "./request.js";

/**
 * Import is all-or-nothing: either every decision identifies a current finding with sufficient authority and all are
 * written, or none are and `rejectedCount` reports how many did not qualify.
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
    // An artifact written by an earlier version names findings by a legacy fingerprint.
    const findingsByKey = new Map(
      collected.findings.flatMap((finding) =>
        [findingKey(finding), ...legacyKeys(finding)].map((key) => [key, finding] as const),
      ),
    );
    const rejectedCount = command.imported.filter((record) => {
      const finding = findingsByKey.get(acceptanceKey(record));
      if (finding === undefined || collected.sources[finding.file] !== record.reviewedSource) return true;
      if (record.type === "revoke") {
        const existing = findStoredAcceptance({ acceptances: snapshot, finding });
        return (
          existing === undefined ||
          existing.acceptedAt !== record.expectedAcceptedAt ||
          existing.reason !== record.expectedReason
        );
      }
      return !acceptanceSatisfies({ acceptance: importedAcceptance(record), finding });
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
    // Every decision is stored under its finding's current fingerprint; the check above found one for each.
    const findingOf = (record: {
      readonly source: FindingRecord["source"];
      readonly fingerprint: FindingRecord["fingerprint"];
    }) => findingsByKey.get(acceptanceKey(record));
    const result = yield* store.reconcile({
      stale: "none",
      current: collected.findings,
      accepted: command.imported
        .filter((record): record is AcceptanceImport => record.type === "accept")
        .map((record) => {
          const accepted = importedAcceptance(record);
          const finding = findingOf(record);
          return finding === undefined || findingKey(finding) === acceptanceKey(accepted)
            ? accepted
            : rekeyedAcceptance({ record: accepted, finding });
        }),
      revoked: command.imported
        .filter((record) => record.type === "revoke")
        .map((record) => ({ ...record, fingerprint: findingOf(record)?.fingerprint ?? record.fingerprint })),
    });
    return new AcceptancesResult({
      records: [...result.records],
      removedCount: result.removed.length,
      importedCount: command.imported.length,
      rejectedCount: 0,
      exitCode: 0,
    });
  }
  const result = yield* store.reconcile({ stale: collected.stale, current: collected.findings });
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
