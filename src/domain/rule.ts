/**
 * Rule definition types and the `defineRule` helper.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";
import type { AgentlintNode } from "./node.js";
import type { TreeSitterNodeType } from "./node-types.js";
import type { RuleContext } from "./rule-context.js";
import { Guidance } from "./guidance.js";
import type { Guidance as GuidanceType } from "./guidance.js";

export const RuleDefinition = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  guidance: Guidance,
});

export type RuleDefinition = Schema.Schema.Type<typeof RuleDefinition>;

/**
 * Callback invoked when a matching AST node type is visited.
 *
 * @since 0.1.0
 * @category models
 */
export type VisitorHandler = (node: AgentlintNode) => void;

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
  before?: ((filename: string) => boolean | void) | undefined;
  after?: (() => void) | undefined;
} & { [K in TreeSitterNodeType]?: VisitorHandler } & {
  [nodeType: string]: VisitorHandler | ((filename: string) => boolean | void) | (() => void) | undefined;
};

export interface AgentlintRule extends RuleDefinition {
  readonly createOnce: (context: RuleContext) => Visitors;
}

export function defineRule(rule: AgentlintRule): AgentlintRule {
  Schema.decodeUnknownSync(RuleDefinition)({
    id: rule.id,
    description: rule.description,
    guidance: rule.guidance,
  });
  if (rule.id.trim().length === 0) {
    throw new Error("Rule id must not be empty");
  }
  return rule;
}

export type RuleGuidance = GuidanceType;
