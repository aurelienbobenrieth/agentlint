/**
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";
import { FindingRecord } from "../../domain/finding.js";

/**
 * @since 0.1.0
 * @category models
 */
export class CheckCommand extends Schema.TaggedClass<CheckCommand>()("CheckCommand", {
  all: Schema.Boolean,
  rules: Schema.Array(Schema.String),
  base: Schema.UndefinedOr(Schema.String),
  files: Schema.Array(Schema.String),
  format: Schema.Literals(["text", "jsonl"]),
  ci: Schema.Boolean,
}) {}

/**
 * @since 0.1.0
 * @category models
 */
export class CheckResult extends Schema.TaggedClass<CheckResult>()("CheckResult", {
  findings: Schema.Array(FindingRecord),
  displayedFindings: Schema.Array(FindingRecord),
  unresolvedCount: Schema.Number,
  resolvedCount: Schema.Number,
  deferredCount: Schema.Number,
  staleCount: Schema.Number,
  exitCode: Schema.Number,
  noMatchingRules: Schema.Boolean,
  availableRules: Schema.Array(Schema.String),
}) {}
