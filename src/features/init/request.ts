/**
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";

/**
 * @since 0.1.0
 * @category models
 */
export class InitCommand extends Schema.TaggedClass<InitCommand>()("InitCommand", {
  /** Optional harness to write integration snippets for. */
  harness: Schema.optional(Schema.UndefinedOr(Schema.String)),
}) {}

/**
 * @since 0.1.0
 * @category models
 */
export class InitResult extends Schema.TaggedClass<InitResult>()("InitResult", {
  /** Whether a new config file was created. */
  created: Schema.Boolean,
  /** Human-readable message describing what happened. */
  message: Schema.String,
}) {}
