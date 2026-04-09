/**
 * Flag types — what rules produce when they detect patterns.
 *
 * {@link FlagOptions} is the rule-author API (passed to `context.flag()`).
 * {@link FlagRecord} is the enriched internal record used by the reporter.
 *
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";
import type { AgentReviewNode } from "./node.js";

/**
 * Options passed to `context.flag()` by rule visitors.
 *
 * @since 0.1.0
 * @category models
 */
export interface FlagOptions {
  /** The AST node that triggered the match. */
  readonly node: AgentReviewNode;
  /** Short one-liner displayed next to file:line in output. */
  readonly message: string;
  /**
   * Override `meta.instruction` for this specific match.
   * Appears inline in per-match notes.
   */
  readonly instruction?: string | undefined;
  /** Hint toward the fix. Not a command - just a nudge. */
  readonly suggest?: string | undefined;
}

/**
 * Enriched flag record after processing — ready for the reporter.
 *
 * Uses `Schema.Class` for structural equality AND runtime validation
 * on construction — invalid fields throw a clear `ParseError`.
 *
 * @since 0.1.0
 * @category models
 */
export class FlagRecord extends Schema.Class<FlagRecord>("FlagRecord")({
  ruleName: Schema.String,
  filename: Schema.String,
  /** 1-based line number. */
  line: Schema.Number,
  /** 1-based column number. */
  col: Schema.Number,
  message: Schema.String,
  sourceSnippet: Schema.String,
  /** 7-char hex hash for stable match identification. */
  hash: Schema.String,
  instruction: Schema.UndefinedOr(Schema.String),
  suggest: Schema.UndefinedOr(Schema.String),
}) {}
