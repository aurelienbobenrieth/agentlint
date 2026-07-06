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
 * Structural constraint applied to a matched node's subtree.
 *
 * `has` requires some descendant (or the node itself) to match the given
 * pattern; `notHas` requires that none does.
 *
 * @since 0.2.0
 * @category models
 */
export const MatchWhere = Schema.Struct({
  has: Schema.optional(Schema.String),
  notHas: Schema.optional(Schema.String),
});

export type MatchWhere = Schema.Schema.Type<typeof MatchWhere>;

/**
 * Declarative trigger for a rule.
 *
 * Exactly one of `pattern` or `query` is required:
 *
 * - `pattern` is code-shaped, matched structurally against the parsed file.
 *   Metavariables: `$NAME` captures one node, `$_` matches one node without
 *   capturing, `$$$NAME` (or bare `$$$`) matches zero or more trailing
 *   siblings. Example: `useQuery($$$ARGS)`.
 * - `query` is a raw tree-sitter query. The capture named `@match`
 *   designates the reported node (falls back to the first capture).
 *
 * `message` supports interpolation: `$NAME` for pattern captures and
 * `@name` for query captures.
 *
 * @since 0.2.0
 * @category models
 */
export const RuleMatch = Schema.Struct({
  pattern: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
  where: Schema.optional(MatchWhere),
  message: Schema.String,
});

export type RuleMatch = Schema.Schema.Type<typeof RuleMatch>;

/**
 * Inline proof of a rule's trigger precision.
 *
 * `invalid` snippets must produce at least one finding; `valid` snippets
 * must produce none. Run them with `agentlint rules test`.
 *
 * @since 0.2.0
 * @category models
 */
export const RuleFixtures = Schema.Struct({
  /** Pseudo-filename that selects the grammar (default `fixture.tsx`). */
  file: Schema.optional(Schema.String),
  valid: Schema.optional(Schema.Array(Schema.String)),
  invalid: Schema.optional(Schema.Array(Schema.String)),
});

export type RuleFixtures = Schema.Schema.Type<typeof RuleFixtures>;

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
  /** Declarative trigger(s). The primary authoring surface. */
  readonly match?: RuleMatch | ReadonlyArray<RuleMatch> | undefined;
  /** Inline valid/invalid snippets validated by `agentlint rules test`. */
  readonly fixtures?: RuleFixtures | undefined;
  /** Imperative visitor escape hatch for stateful or cross-node logic. */
  readonly createOnce?: ((context: RuleContext) => Visitors) | undefined;
}

/**
 * Normalize `rule.match` to an array.
 *
 * @since 0.2.0
 * @category utils
 */
export function ruleMatches(rule: AgentlintRule): ReadonlyArray<RuleMatch> {
  if (!rule.match) return [];
  return Array.isArray(rule.match) ? rule.match : [rule.match as RuleMatch];
}

const RuleMatchDecoder = Schema.decodeUnknownSync(RuleMatch);
const RuleFixturesDecoder = Schema.decodeUnknownSync(RuleFixtures);

export function defineRule(rule: AgentlintRule): AgentlintRule {
  Schema.decodeUnknownSync(RuleDefinition)({
    id: rule.id,
    description: rule.description,
    guidance: rule.guidance,
  });
  if (rule.id.trim().length === 0) {
    throw new Error("Rule id must not be empty");
  }

  const matches = ruleMatches(rule);
  for (const match of matches) {
    RuleMatchDecoder(match);
    if ((match.pattern === undefined) === (match.query === undefined)) {
      throw new Error(`Rule ${rule.id}: each match needs exactly one of "pattern" or "query"`);
    }
  }
  if (rule.fixtures) {
    RuleFixturesDecoder(rule.fixtures);
  }
  if (matches.length === 0 && !rule.createOnce) {
    throw new Error(`Rule ${rule.id} must define "match" or "createOnce"`);
  }

  return rule;
}

export type RuleGuidance = GuidanceType;
