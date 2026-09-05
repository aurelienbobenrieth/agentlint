/** Acceptance maintenance contracts. @module @since 0.2.0 */

import { Schema } from "effect";
import { AcceptanceDecision, AcceptanceRecord } from "../../domain/acceptance.js";

export class AcceptancesCommand extends Schema.TaggedClass<AcceptancesCommand>()("AcceptancesCommand", {
  action: Schema.Literals(["list", "clean", "import"]),
  base: Schema.UndefinedOr(Schema.String),
  imported: Schema.Array(AcceptanceDecision),
}) {}

export class AcceptancesResult extends Schema.TaggedClass<AcceptancesResult>()("AcceptancesResult", {
  records: Schema.Array(AcceptanceRecord),
  removedCount: Schema.Number,
  importedCount: Schema.Number,
  rejectedCount: Schema.Number,
  exitCode: Schema.Number,
}) {}
