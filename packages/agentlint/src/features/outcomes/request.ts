/**
 * Outcome command contracts. @module @since 0.2.0
 */
import { Schema } from "effect";
import { OutcomeKind, OutcomeRecord } from "../../domain/outcome.js";

export class RecordOutcomeCommand extends Schema.TaggedClass<RecordOutcomeCommand>()("RecordOutcomeCommand", {
  selector: Schema.UndefinedOr(Schema.String),
  kind: OutcomeKind,
  reference: Schema.UndefinedOr(Schema.String),
  note: Schema.UndefinedOr(Schema.String),
  base: Schema.UndefinedOr(Schema.String),
}) {}

export class OutcomeResult extends Schema.TaggedClass<OutcomeResult>()("OutcomeResult", {
  message: Schema.String,
  records: Schema.Array(OutcomeRecord),
  exitCode: Schema.Number,
}) {}
