/** Proposal command contracts. @module @since 0.3.0 */

import { Schema } from "effect";

export class ProposeCommand extends Schema.TaggedClass<ProposeCommand>()("ProposeCommand", {
  selector: Schema.UndefinedOr(Schema.String),
  summary: Schema.UndefinedOr(Schema.String),
  diff: Schema.UndefinedOr(Schema.String),
  base: Schema.UndefinedOr(Schema.String),
}) {}

export class ProposeResult extends Schema.TaggedClass<ProposeResult>()("ProposeResult", {
  message: Schema.String,
  exitCode: Schema.Number,
}) {}
