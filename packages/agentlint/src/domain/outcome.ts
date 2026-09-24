/**
 * Longitudinal observations attached to a finding after review.
 *
 * Outcomes never open or close the gate. They preserve delayed evidence that can justify keeping, refining or removing
 * a repository rule.
 *
 * @module
 * @since 0.2.0
 */
import { Schema } from "effect";
import { Fingerprint, FindingSource, findingIdentityKey } from "./fingerprint.js";

const NonEmptyString = Schema.String.check(Schema.isPattern(/\S/));

export const OutcomeKind = Schema.Literals([
  "useful_interception",
  "unnecessary_review",
  "escaped_concern",
  "corrective_change",
  "rollback",
  "incident",
]);
export type OutcomeKind = Schema.Schema.Type<typeof OutcomeKind>;

/**
 * One repository-owned observation about what happened after a finding was reviewed.
 */
export class OutcomeRecord extends Schema.Class<OutcomeRecord>("OutcomeRecord")({
  schemaVersion: Schema.Literal(1),
  source: FindingSource,
  fingerprint: Fingerprint,
  lineageKey: Schema.optional(Schema.String),
  ruleId: NonEmptyString,
  file: NonEmptyString,
  kind: OutcomeKind,
  reference: NonEmptyString,
  note: NonEmptyString,
  actor: NonEmptyString,
  recordedAt: NonEmptyString,
}) {}

/**
 * Stable identity for one observation; a repeated import of the same outcome replaces it.
 */
export function outcomeKey(record: OutcomeRecord): string {
  return `${findingIdentityKey(record)}\u0000${record.kind}\u0000${record.reference}`;
}
