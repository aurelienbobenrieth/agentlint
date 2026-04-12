/**
 * Rule definition types and the `defineRule` helper.
 *
 * A rule is a reusable lint check defined by {@link RuleMeta} (what to check)
 * and a `createOnce` factory (how to check it). The factory returns a
 * {@link Visitors} object whose keys are tree-sitter node types.
 *
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";
import type { AgentReviewNode } from "./node.js";
import type { TreeSitterNodeType } from "./node-types.js";
import type { RuleContext } from "./rule-context.js";

/**
 * Static metadata for a rule.
 *
 * Defined as a `Schema.Struct` so that rule metadata is validated at
 * runtime when `defineRule` is called — catches typos, missing fields,
 * and wrong types with clear error messages.
 *
 * @since 0.1.0
 * @category models
 */
export const RuleMeta = Schema.Struct({
  /** Unique identifier. kebab-case. Used in output and --rule filtering. */
  name: Schema.String,
  /** One-liner explaining what the rule checks. */
  description: Schema.String,
  /** File extensions this rule applies to, without the dot. e.g. `["ts", "tsx"]` */
  languages: Schema.Array(Schema.String),
  /**
   * Natural language instruction for the calling AI agent.
   * Defines pass/fail criteria and how to evaluate flagged matches.
   */
  instruction: Schema.String,
  /** If provided, rule only runs on files matching these globs (after global filtering). */
  include: Schema.optional(Schema.Array(Schema.String)),
  /** If provided, files matching these globs are excluded from this rule. */
  ignore: Schema.optional(Schema.Array(Schema.String)),
});

/** @since 0.1.0 */
export type RuleMeta = Schema.Schema.Type<typeof RuleMeta>;

/**
 * Callback invoked when a matching AST node type is visited.
 *
 * @since 0.1.0
 * @category models
 */
export type VisitorHandler = (node: AgentReviewNode) => void;

/**
 * Visitor object returned by `createOnce`.
 *
 * Maps tree-sitter node type strings to handler functions.
 * Known node types provide autocomplete; any string is accepted.
 *
 * @since 0.1.0
 * @category models
 */
export type Visitors = {
  /**
   * Called once before each file is traversed.
   * Return `false` to skip this file entirely for this rule.
   */
  before?: ((filename: string) => boolean | void) | undefined;
  /**
   * Called once after all files have been visited.
   * Use for aggregate analysis.
   */
  after?: (() => void) | undefined;
} & { [K in TreeSitterNodeType]?: VisitorHandler } & {
  [nodeType: string]: VisitorHandler | ((filename: string) => boolean | void) | (() => void) | undefined;
};

/**
 * A complete rule definition.
 *
 * @since 0.1.0
 * @category models
 */
export interface AgentReviewRule {
  readonly meta: RuleMeta;
  /**
   * Called once per agentlint run (not per file).
   * The returned visitor object is reused across files.
   * Per-file state must be reset in `before()`.
   */
  readonly createOnce: (context: RuleContext) => Visitors;
}

/**
 * Identity function that provides type inference and IDE support for rule definitions.
 *
 * @example
 * ```ts
 * import { defineRule } from "agentlint"
 *
 * export const myRule = defineRule({
 *   meta: {
 *     name: "my-rule",
 *     description: "Checks for something",
 *     languages: ["ts", "tsx"],
 *     instruction: "Evaluate whether ..."
 *   },
 *   createOnce(context) {
 *     return {
 *       comment(node) {
 *         context.flag({ node, message: "Found comment" })
 *       }
 *     }
 *   }
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export function defineRule(rule: AgentReviewRule): AgentReviewRule {
  Schema.decodeUnknownSync(RuleMeta)(rule.meta);
  return rule;
}
