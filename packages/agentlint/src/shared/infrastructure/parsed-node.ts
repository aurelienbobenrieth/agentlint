import type { Node as TSNode } from "web-tree-sitter";
import type { AgentlintNode, Position } from "../../domain/node.js";

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
