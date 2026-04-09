/**
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";

/**
 * @since 0.1.0
 * @category models
 */
export class ReviewCommand extends Schema.TaggedClass<ReviewCommand>()("ReviewCommand", {
  /** Specific hashes to mark as reviewed. */
  hashes: Schema.Array(Schema.String),
  /** When `true`, mark all current flags as reviewed. */
  all: Schema.Boolean,
  /** When `true`, wipe the state file. */
  reset: Schema.Boolean,
}) {}

/**
 * @since 0.1.0
 * @category models
 */
export class ReviewResult extends Schema.TaggedClass<ReviewResult>()("ReviewResult", {
  /** Human-readable message describing what happened. */
  message: Schema.String,
}) {}
