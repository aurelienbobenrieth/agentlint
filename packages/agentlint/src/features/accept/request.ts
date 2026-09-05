/** Acceptance command contracts. @module @since 0.2.0 */

import { Schema } from "effect";
import { Authority } from "../../domain/acceptance.js";

export class AcceptCommand extends Schema.TaggedClass<AcceptCommand>()("AcceptCommand", {
  selector: Schema.UndefinedOr(Schema.String),
  reason: Schema.UndefinedOr(Schema.String),
  authority: Authority,
  base: Schema.UndefinedOr(Schema.String),
}) {}

export class AcceptResult extends Schema.TaggedClass<AcceptResult>()("AcceptResult", {
  message: Schema.String,
  exitCode: Schema.Number,
}) {}
