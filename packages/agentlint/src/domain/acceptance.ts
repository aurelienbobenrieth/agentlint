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
  isChangeFingerprint,
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
    reasons.push(
      prior.source.reviewEpoch !== current.source.reviewEpoch
        ? "The repository advanced the review epoch."
        : "The binding scope, options, or declared dependencies changed.",
    );
  // A decision recorded under a legacy version compares with the finding's fingerprint under that version.
  const comparable = findingFingerprints(current).find(
    (fingerprint) =>
      fingerprint.scheme === prior.fingerprint.scheme && fingerprint.version === prior.fingerprint.version,
  );
  if (comparable === undefined) reasons.push("The evidence fingerprint scheme changed; a new review is required.");
  else if (prior.fingerprint.digest !== comparable.digest)
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
 * The fingerprints a decision about `finding` may carry: the current one, then the same evidence under earlier scheme
 * versions.
 */
function findingFingerprints(
  finding: Pick<FindingRecord, "fingerprint" | "legacyFingerprints">,
): ReadonlyArray<Fingerprint> {
  return [finding.fingerprint, ...(finding.legacyFingerprints ?? [])];
}

/**
 * Exact identity keys of `finding` under its legacy fingerprints.
 */
export function legacyKeys(finding: Pick<FindingRecord, "source" | "legacyFingerprints">): ReadonlyArray<string> {
  return (finding.legacyFingerprints ?? []).map((fingerprint) =>
    findingIdentityKey({ source: finding.source, fingerprint }),
  );
}

/**
 * The same decision, keyed by the finding's current fingerprint and lineage. Only for a record whose legacy fingerprint
 * equals the finding's: equal legacy evidence is equal current evidence.
 */
export function rekeyedAcceptance({
  record,
  finding,
}: {
  readonly record: AcceptanceRecord;
  readonly finding: Pick<FindingRecord, "fingerprint"> & { readonly lineageKey?: string | undefined };
}): AcceptanceRecord {
  return new AcceptanceRecord({
    schemaVersion: record.schemaVersion,
    source: record.source,
    fingerprint: finding.fingerprint,
    lineageKey: finding.lineageKey ?? record.lineageKey,
    reason: record.reason,
    authority: record.authority,
    actor: record.actor,
    acceptedAt: record.acceptedAt,
  });
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
  readonly finding: Pick<FindingRecord, "source" | "fingerprint" | "legacyFingerprints" | "authority">;
}): boolean {
  // A legacy fingerprint counts only as the engine computed it for this finding; a stored one alone never does.
  const legacy = (finding.legacyFingerprints ?? []).some((fingerprint) =>
    sameFingerprint({ left: acceptance.fingerprint, right: fingerprint }),
  );
  return (
    isSupportedFingerprint(finding.fingerprint) &&
    sameFindingSource({ left: acceptance.source, right: finding.source }) &&
    ((isSupportedFingerprint(acceptance.fingerprint) &&
      sameFingerprint({ left: acceptance.fingerprint, right: finding.fingerprint })) ||
      legacy) &&
    authoritySatisfies({ actual: acceptance.authority, required: finding.authority })
  );
}

/**
 * The stored records a check saw every candidate finding for, and so may remove when none matches. Only a view that
 * could have found a record's finding proves it gone.
 *
 * - `all`: a complete scan whose change rules ran against the default branch's merge base.
 * - `state`: a complete scan against another merge base. It sees every state finding, but change findings only relative
 *   to that base, so every change record is outside it.
 * - `none`: a partial scan.
 */
export const StaleScope = Schema.Literals(["none", "state", "all"]);
export type StaleScope = Schema.Schema.Type<typeof StaleScope>;

export function staleScopeCovers({
  scope,
  record,
}: {
  readonly scope: StaleScope;
  readonly record: { readonly fingerprint: Fingerprint };
}): boolean {
  return scope === "all" || (scope === "state" && !isChangeFingerprint(record.fingerprint));
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
 * The decision stored for `finding`, under its current fingerprint or, until a complete check re-keys it, a legacy one.
 * It may still lack the authority the finding requires.
 */
export function findStoredAcceptance({
  acceptances,
  finding,
}: {
  readonly acceptances: AcceptanceSnapshot;
  readonly finding: Pick<FindingRecord, "source" | "fingerprint" | "legacyFingerprints">;
}): AcceptanceRecord | undefined {
  return [acceptanceKey(finding), ...legacyKeys(finding)]
    .map((key) => acceptances.byKey.get(key))
    .find((record) => record !== undefined);
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
  readonly finding: Pick<FindingRecord, "source" | "fingerprint" | "legacyFingerprints" | "authority">;
}): AcceptanceRecord | undefined {
  const record = findStoredAcceptance({ acceptances, finding });
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
