/**
 * Current acceptance state and compatibility rules.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";
import { compareStrings } from "./compare.js";
import type { FindingRecord } from "./finding.js";
import {
  Fingerprint,
  FindingSource,
  findingIdentityKey,
  isSupportedFingerprint,
  sameFingerprint,
  sameFindingSource,
} from "./fingerprint.js";
import { RuleAuthority } from "./rule/primitives.js";

/**
 * The authority path that made or is required to make a decision. Same literals as `RuleAuthority`.
 */
export const Authority = RuleAuthority;
export type Authority = RuleAuthority;

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/));

/**
 * The UTC form `Date#toISOString` writes. Lineage orders records by this string, so no other spelling is accepted.
 */
const IsoTimestamp = Schema.String.check(
  Schema.makeFilter((value) => {
    const time = Date.parse(value);
    return (
      (!Number.isNaN(time) && new Date(time).toISOString() === value) ||
      "Expected an ISO-8601 UTC timestamp such as 2026-01-31T12:00:00.000Z"
    );
  }),
);

/**
 * The only persisted finding outcome.
 */
export class AcceptanceRecord extends Schema.Class<AcceptanceRecord>("AcceptanceRecord")({
  schemaVersion: Schema.Literal(1),
  source: FindingSource,
  fingerprint: Fingerprint,
  lineageKey: Schema.optional(Schema.String),
  reason: NonEmptyString,
  authority: Authority,
  actor: Schema.optional(Schema.String),
  acceptedAt: IsoTimestamp,
}) {}

/**
 * A detached acceptance carries the exact source the reviewer saw. It is verified at import and never persisted.
 */
export class AcceptanceImport extends Schema.Class<AcceptanceImport>("AcceptanceImport")({
  schemaVersion: Schema.Literal(1),
  type: Schema.Literal("accept"),
  source: FindingSource,
  fingerprint: Fingerprint,
  lineageKey: Schema.optional(Schema.String),
  reason: NonEmptyString,
  authority: Authority,
  actor: Schema.optional(Schema.String),
  acceptedAt: IsoTimestamp,
  reviewedSource: Schema.String,
}) {}

/**
 * An imported revocation targets both the reviewed source and decision, never a later replacement.
 */
export class AcceptanceRevocation extends Schema.Class<AcceptanceRevocation>("AcceptanceRevocation")({
  schemaVersion: Schema.Literal(1),
  type: Schema.Literal("revoke"),
  source: FindingSource,
  fingerprint: Fingerprint,
  expectedAcceptedAt: NonEmptyString,
  expectedReason: NonEmptyString,
  reviewedSource: Schema.String,
}) {}

export const AcceptanceDecision = Schema.Union([AcceptanceImport, AcceptanceRevocation]);
export type AcceptanceDecision = Schema.Schema.Type<typeof AcceptanceDecision>;

/**
 * Explain compatibility changes without claiming to reconstruct historical source.
 */
export function invalidationReasons({
  prior,
  current,
}: {
  readonly prior: AcceptanceRecord;
  readonly current: FindingRecord;
}): string[] {
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
  if (!authoritySatisfies({ actual: prior.authority, required: current.authority }))
    reasons.push("The binding now requires human authority.");
  return reasons;
}

/**
 * Exact persisted identity key.
 */
export function acceptanceKey(record: Pick<AcceptanceRecord, "source" | "fingerprint">): string {
  return findingIdentityKey({ source: record.source, fingerprint: record.fingerprint });
}

/**
 * Human authority satisfies both policies. Agent authority satisfies only agent policy.
 */
export function authoritySatisfies({
  actual,
  required,
}: {
  readonly actual: Authority;
  readonly required: Authority;
}): boolean {
  return actual === "human" || required === "agent";
}

/**
 * Check exact source, fingerprint, and authority compatibility.
 */
export function acceptanceSatisfies({
  acceptance,
  finding,
}: {
  readonly acceptance: AcceptanceRecord;
  readonly finding: Pick<FindingRecord, "source" | "fingerprint" | "authority">;
}): boolean {
  return (
    isSupportedFingerprint(finding.fingerprint) &&
    isSupportedFingerprint(acceptance.fingerprint) &&
    sameFindingSource({ left: acceptance.source, right: finding.source }) &&
    sameFingerprint({ left: acceptance.fingerprint, right: finding.fingerprint }) &&
    authoritySatisfies({ actual: acceptance.authority, required: finding.authority })
  );
}

/**
 * Current records with their exact identity index.
 */
export interface AcceptanceSnapshot {
  readonly records: ReadonlyArray<AcceptanceRecord>;
  readonly byKey: ReadonlyMap<string, AcceptanceRecord>;
}

export function acceptanceSnapshot(records: ReadonlyArray<AcceptanceRecord>): AcceptanceSnapshot {
  return { records, byKey: new Map(records.map((record) => [acceptanceKey(record), record])) };
}

/**
 * Find the acceptance that opens the gate for `finding`, using the exact identity index. Equivalent to scanning
 * `records` with `acceptanceSatisfies`.
 */
export function lookupAcceptance({
  acceptances,
  finding,
}: {
  readonly acceptances: AcceptanceSnapshot;
  readonly finding: Pick<FindingRecord, "source" | "fingerprint" | "authority">;
}): AcceptanceRecord | undefined {
  const record = acceptances.byKey.get(acceptanceKey(finding));
  return record !== undefined && acceptanceSatisfies({ acceptance: record, finding }) ? record : undefined;
}

function isRelated({
  record,
  finding,
}: {
  readonly record: AcceptanceRecord;
  readonly finding: FindingRecord;
}): boolean {
  return (
    finding.lineageKey !== undefined &&
    record.lineageKey === finding.lineageKey &&
    record.source.standardId === finding.source.standardId &&
    record.source.detectorId === finding.source.detectorId &&
    record.source.bindingId === finding.source.bindingId
  );
}

/**
 * Find the latest related reason. This result never opens the gate.
 */
export function findLineage({
  records,
  finding,
}: {
  readonly records: ReadonlyArray<AcceptanceRecord>;
  readonly finding: FindingRecord;
}): AcceptanceRecord | undefined {
  return records
    .filter((record) => isRelated({ record, finding }) && !acceptanceSatisfies({ acceptance: record, finding }))
    .toSorted((left, right) => compareStrings({ left: right.acceptedAt, right: left.acceptedAt }))[0];
}
