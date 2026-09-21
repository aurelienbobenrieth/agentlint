/**
 * Public syntax node contract.
 *
 * Provides a stable public API that keeps the tree-sitter dependency out of the consumer-facing surface. Children and
 * parent are wrapped on first access — nodes that are never inspected cost nothing.
 *
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";

/**
 * 0-indexed position in source text.
 *
 * Defined as a `Schema.Struct` so positions can be decoded and validated from external sources if needed.
 *
 * @since 0.1.0
 * @category Models
 */
export const Position = Schema.Struct({
  row: Schema.Number,
  column: Schema.Number,
});

/**
 * @since 0.1.0
 */
export type Position = Schema.Schema.Type<typeof Position>;

/**
 * Read-only view of a syntax tree node.
 *
 * One universal type — no per-kind subtypes. Rules narrow via `node.type` string checks and field accessors.
 *
 * @since 0.1.0
 * @category Models
 */
export interface AgentlintNode {
  /**
   * Tree-sitter grammar node type (e.g. `"function_declaration"`, `"comment"`)
   */
  readonly type: string;
  /**
   * Full source text covered by this node.
   */
  readonly text: string;
  /**
   * 0-indexed start position.
   */
  readonly startPosition: Position;
  /**
   * 0-indexed end position.
   */
  readonly endPosition: Position;
  /**
   * Whether this is a named node in the grammar.
   */
  readonly isNamed: boolean;
  /**
   * Direct child nodes (lazily wrapped).
   */
  readonly children: ReadonlyArray<AgentlintNode>;
  /**
   * Parent node, or null for the root.
   */
  readonly parent: AgentlintNode | null;
  /**
   * Number of direct children.
   */
  readonly childCount: number;

  /**
   * Get a child by its grammar field name (e.g. `"name"`, `"body"`).
   */
  childByFieldName(name: string): AgentlintNode | null;
  /**
   * All direct children matching the given node type.
   */
  childrenByType(type: string): ReadonlyArray<AgentlintNode>;
  /**
   * Recursively collect all descendants matching the given node type.
   */
  descendantsOfType(type: string): ReadonlyArray<AgentlintNode>;
}
