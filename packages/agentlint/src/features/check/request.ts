/** Check application contracts. @module @since 0.2.0 */

import { Schema } from "effect";
import { AcceptanceRecord } from "../../domain/acceptance.js";
import { FindingRecord } from "../../domain/finding.js";

export class CheckCommand extends Schema.TaggedClass<CheckCommand>()("CheckCommand", {
  all: Schema.Boolean,
  rules: Schema.Array(Schema.String),
  base: Schema.UndefinedOr(Schema.String),
  files: Schema.Array(Schema.String),
  format: Schema.Literals(["text", "jsonl"]),
}) {}

export const CheckLineage = Schema.Struct({
  findingKey: Schema.String,
  reason: Schema.String,
  authority: Schema.Literals(["agent", "human"]),
  acceptedAt: Schema.String,
});
export type CheckLineage = Schema.Schema.Type<typeof CheckLineage>;

export class CheckResult extends Schema.TaggedClass<CheckResult>()("CheckResult", {
  findings: Schema.Array(FindingRecord),
  sources: Schema.Record(Schema.String, Schema.String),
  scannedFiles: Schema.Array(Schema.String),
  acceptances: Schema.Array(AcceptanceRecord),
  unresolved: Schema.Array(FindingRecord),
  accepted: Schema.Array(FindingRecord),
  lineage: Schema.Array(CheckLineage),
  staleCount: Schema.Number,
  scope: Schema.Literals(["partial", "complete"]),
  base: Schema.UndefinedOr(Schema.String),
  exitCode: Schema.Number,
  noMatchingRules: Schema.Boolean,
  availableRules: Schema.Array(Schema.String),
}) {}
