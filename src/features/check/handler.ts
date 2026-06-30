/**
 * @module
 * @since 0.1.0
 */

import { Effect } from "effect";
import { withSelector } from "../../domain/finding.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { ledgerKey, LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { CheckCommand, CheckResult } from "./request.js";

/** @since 0.1.0 */
export const checkHandler = Effect.fn("checkHandler")(function* (command: CheckCommand) {
  const configLoader = yield* ConfigLoader;
  const ledgerStore = yield* LedgerStore;
  const selectorCache = yield* SelectorCache;

  const config = yield* configLoader.load();
  const availableRules = Object.keys(config.rules ?? {}).toSorted();
  const result = yield* collectFindings({
    all: command.all,
    rules: command.rules,
    base: command.base,
    files: command.files,
  });

  if (result.noMatchingRules) {
    return new CheckResult({
      findings: [],
      displayedFindings: [],
      unresolvedCount: 0,
      resolvedCount: 0,
      deferredCount: 0,
      staleCount: 0,
      exitCode: 2,
      noMatchingRules: true,
      availableRules,
    });
  }

  const snapshot = yield* ledgerStore.read();
  const currentKeys = new Set(result.findings.map((finding) => ledgerKey(finding.ruleId, finding.hash)));
  const staleCount = [...snapshot.latestByKey.keys()].filter((key) => !currentKeys.has(key)).length;

  const unresolved = [];
  const resolved = [];
  const deferred = [];

  for (const finding of result.findings) {
    const disposition = snapshot.latestByKey.get(ledgerKey(finding.ruleId, finding.hash));
    if (!disposition) {
      unresolved.push(finding);
    } else {
      resolved.push(finding);
      if (disposition.status === "deferred") {
        deferred.push(finding);
      }
    }
  }

  const blocking = command.ci ? [...unresolved, ...deferred] : unresolved;
  const displayedFindings = blocking.map((finding, index) => withSelector(finding, String(index + 1)));
  if (command.format === "text" || command.format === "jsonl") {
    yield* selectorCache.write(
      displayedFindings.map((finding) => ({
        selector: finding.selector ?? "",
        hash: finding.hash,
        ruleId: finding.ruleId,
        file: finding.file,
        line: finding.line,
        column: finding.column,
      })),
    );
  }

  return new CheckResult({
    findings: result.findings,
    displayedFindings,
    unresolvedCount: unresolved.length,
    resolvedCount: resolved.length,
    deferredCount: deferred.length,
    staleCount,
    exitCode: blocking.length > 0 ? 1 : 0,
    noMatchingRules: false,
    availableRules,
  });
});
