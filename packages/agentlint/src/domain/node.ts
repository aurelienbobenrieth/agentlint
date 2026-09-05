/**
 * Lazy wrapper around tree-sitter's `Node`.
 *
 * Provides a stable public API that keeps the tree-sitter dependency
 * out of the consumer-facing surface. Children and parent are wrapped
 * on first access — nodes that are never inspected cost nothing.
 *
 * @module
 * @since 0.1.0
 */

import { Schema } from "effect";
import type { Node as TSNode } from "web-tree-sitter";

/**
 * 0-indexed position in source text.
 *
 * Defined as a `Schema.Struct` so positions can be decoded and
 * validated from external sources if needed.
 *
 * @since 0.1.0
 * @category models
 */
export const Position = Schema.Struct({
  row: Schema.Number,
  column: Schema.Number,
});

/** @since 0.1.0 */
export type Position = Schema.Schema.Type<typeof Position>;

/**
 * Read-only view of a syntax tree node.
 *
 * One universal type — no per-kind subtypes. Rules narrow via
 * `node.type` string checks and field accessors.
 *
 * @since 0.1.0
 * @category models
 */
export interface AgentlintNode {
  /** tree-sitter grammar node type (e.g. `"function_declaration"`, `"comment"`) */
  readonly type: string;
  /** Full source text covered by this node. */
  readonly text: string;
  /** 0-indexed start position. */
  readonly startPosition: Position;
  /** 0-indexed end position. */
  readonly endPosition: Position;
  /** Whether this is a named node in the grammar. */
  readonly isNamed: boolean;
  /** Direct child nodes (lazily wrapped). */
  readonly children: ReadonlyArray<AgentlintNode>;
  /** Parent node, or null for the root. */
  readonly parent: AgentlintNode | null;
  /** Number of direct children. */
  readonly childCount: number;

  /** Get a child by its grammar field name (e.g. `"name"`, `"body"`). */
  childByFieldName(name: string): AgentlintNode | null;
  /** All direct children matching the given node type. */
  childrenByType(type: string): ReadonlyArray<AgentlintNode>;
  /** Recursively collect all descendants matching the given node type. */
  descendantsOfType(type: string): ReadonlyArray<AgentlintNode>;
}

/**
 * Private implementation of {@link AgentlintNode}.
 *
 * Wraps a tree-sitter `Node` and lazily creates child/parent wrappers
 * on first access. Nodes that are never traversed incur zero allocation.
 *
 * @since 0.1.0
 * @category internals
 */
class AgentlintNodeImpl implements AgentlintNode {
  readonly #inner: TSNode;
  #children: ReadonlyArray<AgentlintNode> | undefined;
  #parent: AgentlintNode | null | undefined;

  constructor(inner: TSNode) {
    this.#inner = inner;
  }

  get type(): string {
    return this.#inner.type;
  }

  get text(): string {
    return this.#inner.text;
  }

  get startPosition(): Position {
    return this.#inner.startPosition;
  }

  get endPosition(): Position {
    return this.#inner.endPosition;
  }

  get isNamed(): boolean {
    return this.#inner.isNamed;
  }

  get childCount(): number {
    return this.#inner.childCount;
  }

  get children(): ReadonlyArray<AgentlintNode> {
    if (this.#children === undefined) {
      const result: AgentlintNode[] = [];
      for (const c of this.#inner.children) {
        if (c !== null) result.push(new AgentlintNodeImpl(c));
      }
      this.#children = result;
    }
    return this.#children;
  }

  get parent(): AgentlintNode | null {
    if (this.#parent === undefined) {
      const p = this.#inner.parent;
      this.#parent = p ? new AgentlintNodeImpl(p) : null;
    }
    return this.#parent;
  }

  childByFieldName(name: string): AgentlintNode | null {
    const child = this.#inner.childForFieldName(name);
    return child ? new AgentlintNodeImpl(child) : null;
  }

  childrenByType(type: string): ReadonlyArray<AgentlintNode> {
    const result: AgentlintNode[] = [];
    for (const c of this.#inner.children) {
      if (c !== null && c.type === type) result.push(new AgentlintNodeImpl(c));
    }
    return result;
  }

  descendantsOfType(type: string): ReadonlyArray<AgentlintNode> {
    const result: AgentlintNode[] = [];
    for (const c of this.#inner.descendantsOfType(type)) {
      if (c !== null) result.push(new AgentlintNodeImpl(c));
    }
    return result;
  }
}

/**
 * Wrap a raw tree-sitter node in the public {@link AgentlintNode} interface.
 *
 * This is the only bridge between the internal tree-sitter dependency
 * and the consumer-facing API. All child/parent nodes are lazily wrapped
 * on access.
 *
 * @since 0.1.0
 * @category constructors
 */
export function wrapNode(inner: TSNode): AgentlintNode {
  return new AgentlintNodeImpl(inner);
}
