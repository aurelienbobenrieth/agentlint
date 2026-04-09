/**
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";

/**
 * @since 0.1.0
 * @category models
 */
export const RuleSummary = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  languages: Schema.Array(Schema.String),
  include: Schema.UndefinedOr(Schema.Array(Schema.String)),
  ignore: Schema.UndefinedOr(Schema.Array(Schema.String)),
});

/** @since 0.1.0 */
export type RuleSummary = Schema.Schema.Type<typeof RuleSummary>;

/**
 * @since 0.1.0
 * @category models
 */
export class ListCommand extends Schema.TaggedClass<ListCommand>()("ListCommand", {}) {}

/**
 * @since 0.1.0
 * @category models
 */
export class ListResult extends Schema.TaggedClass<ListResult>()("ListResult", {
  /** All registered rules with their metadata. */
  rules: Schema.Array(RuleSummary),
}) {}
