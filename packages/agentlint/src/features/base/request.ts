/**
 * Change base command contracts. @module
 */

import { Schema } from "effect";

export class BaseCommand extends Schema.TaggedClass<BaseCommand>()("BaseCommand", {
  base: Schema.UndefinedOr(Schema.String),
}) {}

/**
 * The ref change rules compare against, where HEAD left it, and what named it.
 */
export class BaseResult extends Schema.TaggedClass<BaseResult>()("BaseResult", {
  ref: Schema.String,
  commit: Schema.String,
  source: Schema.Literals(["--base", "AGENTLINT_BASE", "config", "upstream", "default"]),
}) {}
