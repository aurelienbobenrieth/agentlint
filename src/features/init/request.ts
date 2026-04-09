/**
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";

/**
 * @since 0.1.0
 * @category models
 */
export class InitCommand extends Schema.TaggedClass<InitCommand>()("InitCommand", {}) {}

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
