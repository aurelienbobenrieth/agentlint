/** Acceptance maintenance handler. @module @since 0.2.0 */

import { Effect } from "effect";
import { acceptanceSatisfies } from "../../domain/acceptance.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { AcceptancesCommand, AcceptancesResult } from "./request.js";

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
    const valid = command.imported.filter((record) =>
      collected.findings.some((finding) => acceptanceSatisfies(record, finding)),
    );
    if (valid.length !== command.imported.length) {
      const snapshot = yield* store.read();
      return new AcceptancesResult({
        records: [...snapshot.records],
        removedCount: 0,
        importedCount: 0,
        rejectedCount: command.imported.length - valid.length,
        exitCode: 2,
      });
    }
    const result = yield* store.reconcile({ scope: "partial", current: collected.findings, accepted: valid });
    return new AcceptancesResult({
      records: [...result.records],
      removedCount: result.removed.length,
      importedCount: valid.length,
      rejectedCount: command.imported.length - valid.length,
      exitCode: valid.length === command.imported.length ? 0 : 2,
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
