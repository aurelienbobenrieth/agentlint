/**
 * Resumable review handoff. @module @since 0.2.0
 */
import { Schema } from "effect";
export { NextResult } from "../review/contract.js";

export class NextCommand extends Schema.TaggedClass<NextCommand>()("NextCommand", {
  base: Schema.UndefinedOr(Schema.String),
  rules: Schema.Array(Schema.String),
}) {}
