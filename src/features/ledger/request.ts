import { Schema } from "effect";

export class LedgerListCommand extends Schema.TaggedClass<LedgerListCommand>()("LedgerListCommand", {
  rule: Schema.UndefinedOr(Schema.String),
}) {}

export class LedgerGcCommand extends Schema.TaggedClass<LedgerGcCommand>()("LedgerGcCommand", {
  rule: Schema.UndefinedOr(Schema.String),
  write: Schema.Boolean,
}) {}

export class LedgerResult extends Schema.TaggedClass<LedgerResult>()("LedgerResult", {
  message: Schema.String,
  exitCode: Schema.Number,
}) {}
