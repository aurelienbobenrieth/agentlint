/**
 * Current acceptance state and compatibility rules.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";
import type { FindingRecord } from "./finding.js";
import {
  Fingerprint,
  FindingSource,
  findingIdentityKey,
  isSupportedFingerprint,
  sameFingerprint,
  sameFindingSource,
} from "./fingerprint.js";
import { RuleAuthority } from "./rule.js";

/** The authority path that made or is required to make a decision. Same literals as `RuleAuthority`. */
export const Authority = RuleAuthority;
export type Authority = RuleAuthority;

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/));

/** The only persisted finding outcome. */
export class AcceptanceRecord extends Schema.Class<AcceptanceRecord>("AcceptanceRecord")({
  schemaVersion: Schema.Literal(1),
  source: FindingSource,
  fingerprint: Fingerprint,
  lineageKey: Schema.UndefinedOr(Schema.String),
  reason: NonEmptyString,
  authority: Authority,
  actor: Schema.UndefinedOr(Schema.String),
  acceptedAt: NonEmptyString,
}) {}

/** An imported revocation targets the reviewed decision, never a later replacement. Not persisted in the store. */
export class AcceptanceRevocation extends Schema.Class<AcceptanceRevocation>("AcceptanceRevocation")({
  schemaVersion: Schema.Literal(1),
  type: Schema.Literal("revoke"),
  source: FindingSource,
  fingerprint: Fingerprint,
  expectedAcceptedAt: NonEmptyString,
  expectedReason: NonEmptyString,
}) {}

export const AcceptanceDecision = Schema.Union([AcceptanceRecord, AcceptanceRevocation]);
export type AcceptanceDecision = Schema.Schema.Type<typeof AcceptanceDecision>;

/** Explain compatibility changes without claiming to reconstruct historical source. */
export function invalidationReasons(prior: AcceptanceRecord, current: FindingRecord): string[] {
  const reasons: string[] = [];
  if (prior.source.standardRevision !== current.source.standardRevision) reasons.push("The standard revision changed.");
  if (prior.source.detectorVersion !== current.source.detectorVersion) reasons.push("The detector version changed.");
  if (prior.source.bindingDigest !== current.source.bindingDigest)
    reasons.push("The binding scope, options, or declared dependencies changed.");
  if (
    prior.fingerprint.version !== current.fingerprint.version ||
    prior.fingerprint.scheme !== current.fingerprint.scheme
  )
    reasons.push("The evidence fingerprint scheme changed; a new review is required.");
  else if (prior.fingerprint.digest !== current.fingerprint.digest)
    reasons.push(
      current.lifecycle === "state"
        ? "The containing file structure, occurrence, or declared dependency evidence changed."
        : "The detector-selected change evidence changed.",
    );
  if (!authoritySatisfies(prior.authority, current.authority))
    reasons.push("The binding now requires human authority.");
  return reasons;
}

/** Gate state is derived, not persisted. */
export const FindingState = Schema.Literals(["unresolved", "accepted"]);
export type FindingState = Schema.Schema.Type<typeof FindingState>;

/** Exact persisted identity key. */
export function acceptanceKey(record: Pick<AcceptanceRecord, "source" | "fingerprint">): string {
  return findingIdentityKey(record.source, record.fingerprint);
}

/** Human authority satisfies both policies. Agent authority satisfies only agent policy. */
export function authoritySatisfies(actual: Authority, required: Authority): boolean {
  return actual === "human" || required === "agent";
}

/** Check exact source, fingerprint, and authority compatibility. */
export function acceptanceSatisfies(
  acceptance: AcceptanceRecord,
  finding: Pick<FindingRecord, "source" | "fingerprint" | "authority">,
): boolean {
  return (
    isSupportedFingerprint(finding.fingerprint) &&
    isSupportedFingerprint(acceptance.fingerprint) &&
    sameFindingSource(acceptance.source, finding.source) &&
    sameFingerprint(acceptance.fingerprint, finding.fingerprint) &&
    authoritySatisfies(acceptance.authority, finding.authority)
  );
}

/** Resolve binary gate state from a current acceptance collection. */
export function findingState(finding: FindingRecord, records: ReadonlyArray<AcceptanceRecord>): FindingState {
  return records.some((record) => acceptanceSatisfies(record, finding)) ? "accepted" : "unresolved";
}

function isRelated(record: AcceptanceRecord, finding: FindingRecord): boolean {
  return (
    finding.lineageKey !== undefined &&
    record.lineageKey === finding.lineageKey &&
    record.source.standardId === finding.source.standardId &&
    record.source.detectorId === finding.source.detectorId &&
    record.source.bindingId === finding.source.bindingId
  );
}

/** Find the latest related reason. This result never opens the gate. */
export function findLineage(
  records: ReadonlyArray<AcceptanceRecord>,
  finding: FindingRecord,
): AcceptanceRecord | undefined {
  return records
    .filter((record) => isRelated(record, finding) && !acceptanceSatisfies(record, finding))
    .toSorted((left, right) => right.acceptedAt.localeCompare(left.acceptedAt))[0];
}

/** Test whether two records refer to the same detector-owned lineage. */
export function sameLineage(left: AcceptanceRecord, right: AcceptanceRecord): boolean {
  return (
    left.lineageKey !== undefined &&
    left.lineageKey === right.lineageKey &&
    left.source.standardId === right.source.standardId &&
    left.source.detectorId === right.source.detectorId &&
    left.source.bindingId === right.source.bindingId
  );
}
