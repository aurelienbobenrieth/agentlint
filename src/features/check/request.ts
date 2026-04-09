/**
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";
import { FlagRecord } from "../../domain/flag.js";

/**
 * @since 0.1.0
 * @category models
 */
export class CheckCommand extends Schema.TaggedClass<CheckCommand>()("CheckCommand", {
  /** When `true`, scan all files instead of only git-changed files. */
  all: Schema.Boolean,
  /** Rule name filter. Empty array means "run all rules". */
  rules: Schema.Array(Schema.String),
  /** When `true`, suppress instruction and hint blocks in output. */
  dryRun: Schema.Boolean,
  /** Git ref to diff against. `undefined` means auto-detect. */
  base: Schema.UndefinedOr(Schema.String),
  /** Explicit file paths from positional CLI arguments. */
  files: Schema.Array(Schema.String),
}) {}

/**
 * @since 0.1.0
 * @category models
 */
export class CheckResult extends Schema.TaggedClass<CheckResult>()("CheckResult", {
  /** Unreviewed flags to display. */
  flags: Schema.Array(FlagRecord),
  /** Total flags before filtering out reviewed ones. */
  totalFlags: Schema.Number,
  /** Number of flags filtered out because they were previously reviewed. */
  filteredCount: Schema.Number,
  /** `true` when the `--rule` filter matched no registered rules. */
  noMatchingRules: Schema.Boolean,
  /** Available rule names (for error messages when no match). */
  availableRules: Schema.Array(Schema.String),
}) {}
