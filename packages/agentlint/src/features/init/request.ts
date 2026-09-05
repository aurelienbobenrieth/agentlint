/** Initialization contracts. @module @since 0.2.0 */
import { Schema } from "effect";

export class InitCommand extends Schema.TaggedClass<InitCommand>()("InitCommand", {}) {}
export class InitResult extends Schema.TaggedClass<InitResult>()("InitResult", {
  created: Schema.Boolean,
  message: Schema.String,
}) {}
