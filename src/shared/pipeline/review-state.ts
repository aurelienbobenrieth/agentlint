/**
 * Review state assembly.
 *
 * Joins current findings with their latest ledger dispositions and computes
 * the delta against a git base ref. This is the single data source behind
 * `agentlint ledger review` and the local review UI.
 *
 * @module
 * @since 0.2.0
 */

import { Effect } from "effect";
import type { FindingRecord } from "../../domain/finding.js";
import { Git } from "../infrastructure/git.js";
import { ledgerKey, LedgerStore, parseLedger, type LedgerRecord } from "../infrastructure/ledger-store.js";
import { collectFindings } from "./collect-findings.js";

const LEDGER_FILE = ".agentlint/ledger.jsonl";

/**
 * A finding joined with its latest ledger disposition, when one exists.
 *
 * @since 0.2.0
 * @category models
 */
export interface ReviewedFinding {
  readonly finding: FindingRecord;
  readonly disposition: LedgerRecord | undefined;
}

/**
 * @since 0.2.0
 * @category models
 */
export interface ReviewState {
  /** Git ref the delta was computed against. */
  readonly base: string;
  /** All current findings joined with their latest dispositions. */
  readonly findings: ReadonlyArray<ReviewedFinding>;
  /** Findings whose latest disposition is `approval_requested`. */
  readonly pendingApprovals: ReadonlyArray<ReviewedFinding>;
  /** Findings with no disposition at all. */
  readonly unresolved: ReadonlyArray<ReviewedFinding>;
  /** Ledger records added since `base`, oldest first. */
  readonly newRecords: ReadonlyArray<LedgerRecord>;
  /** Ledger records whose finding no longer exists in current code. */
  readonly staleRecords: ReadonlyArray<LedgerRecord>;
}

function recordIdentity(record: LedgerRecord): string {
  return JSON.stringify([record.ruleId, record.hash, record.status, record.reason, record.actor, record.at]);
}

/**
 * Build the full review state for the working tree against `baseRef`
 * (defaults to the detected default branch).
 *
 * @since 0.2.0
 * @category constructors
 */
export const buildReviewState = Effect.fn("buildReviewState")(function* (baseRef: string | undefined) {
  const git = yield* Git;
  const ledgerStore = yield* LedgerStore;

  const base = baseRef ?? (yield* git.detectDefaultBranch());
  const snapshot = yield* ledgerStore.read();
  const collection = yield* collectFindings({ all: true, rules: [], base: undefined, files: [] });

  const findings: ReviewedFinding[] = collection.findings.map((finding) => ({
    finding,
    disposition: snapshot.latestByKey.get(ledgerKey(finding.ruleId, finding.hash)),
  }));

  const currentKeys = new Set(collection.findings.map((finding) => ledgerKey(finding.ruleId, finding.hash)));
  const staleRecords = [...snapshot.latestByKey.values()].filter(
    (record) => !currentKeys.has(ledgerKey(record.ruleId, record.hash)),
  );

  const baseContent = yield* git.showFile(base, LEDGER_FILE);
  // An unparseable base ledger (e.g. records from a newer version on another
  // branch) degrades to "everything is new" instead of failing the review.
  const baseRecords =
    baseContent === undefined
      ? []
      : yield* Effect.try({ try: () => parseLedger(baseContent), catch: () => undefined }).pipe(
          Effect.orElseSucceed(() => [] as LedgerRecord[]),
        );
  const baseIdentities = new Set(baseRecords.map(recordIdentity));
  const newRecords = snapshot.records.filter((record) => !baseIdentities.has(recordIdentity(record)));

  return {
    base,
    findings,
    pendingApprovals: findings.filter((entry) => entry.disposition?.status === "approval_requested"),
    unresolved: findings.filter((entry) => entry.disposition === undefined),
    newRecords,
    staleRecords,
  } satisfies ReviewState;
});
