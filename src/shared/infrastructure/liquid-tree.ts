/**
 * Liquid frontend: adapts `@shopify/liquid-html-parser`'s unified
 * Liquid + HTML AST to the tree-sitter `Tree`/`Node` surface the
 * walker and `AgentlintNode` consume.
 *
 * This is the same parser Shopify's theme-check and
 * prettier-plugin-liquid use, so rules see real `HtmlElement`,
 * `LiquidTag`, `LiquidVariableOutput`, … nodes with full HTML
 * structure — no tree-sitter grammar required.
 *
 * @module
 * @since 0.2.0
 */

import { nonTraversableProperties, toLiquidHtmlAST } from "@shopify/liquid-html-parser";
import type { Node as TSNode, Tree } from "web-tree-sitter";

type LiquidAstNode = {
  readonly type: string;
  readonly position: { readonly start: number; readonly end: number };
  readonly [key: string]: unknown;
};

function isAstNode(value: unknown): value is LiquidAstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LiquidAstNode).type === "string" &&
    typeof (value as LiquidAstNode).position === "object"
  );
}

const skippedProperties = new Set<string>([...nonTraversableProperties, "parentNode", "prev", "next", "source"]);

function lineOffsets(source: string): readonly number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function positionAt(offsets: readonly number[], offset: number): { row: number; column: number } {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((offsets[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return { row: low, column: offset - (offsets[low] ?? 0) };
}

/**
 * Structural stand-in for tree-sitter's `Node`, backed by a LiquidHTML
 * AST node. Only the members `AgentlintNode` and the walker touch are
 * implemented.
 */
class LiquidNode {
  readonly #ast: LiquidAstNode;
  readonly #source: string;
  readonly #offsets: readonly number[];
  readonly parent: LiquidNode | null;
  #children: readonly LiquidNode[] | undefined;
  #fields: ReadonlyMap<string, LiquidNode> | undefined;

  constructor(ast: LiquidAstNode, source: string, offsets: readonly number[], parent: LiquidNode | null) {
    this.#ast = ast;
    this.#source = source;
    this.#offsets = offsets;
    this.parent = parent;
  }

  get type(): string {
    return this.#ast.type;
  }

  get text(): string {
    return this.#source.slice(this.#ast.position.start, this.#ast.position.end);
  }

  get startPosition(): { row: number; column: number } {
    return positionAt(this.#offsets, this.#ast.position.start);
  }

  get endPosition(): { row: number; column: number } {
    return positionAt(this.#offsets, this.#ast.position.end);
  }

  get isNamed(): boolean {
    return true;
  }

  #materialize(): void {
    if (this.#children !== undefined) return;
    const children: { node: LiquidNode; field: string }[] = [];
    for (const [key, value] of Object.entries(this.#ast)) {
      if (skippedProperties.has(key) || key === "position") continue;
      if (isAstNode(value)) {
        children.push({ node: new LiquidNode(value, this.#source, this.#offsets, this), field: key });
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (isAstNode(entry)) {
            children.push({ node: new LiquidNode(entry, this.#source, this.#offsets, this), field: key });
          }
        }
      }
    }
    children.sort((a, b) => a.node.#ast.position.start - b.node.#ast.position.start);
    this.#children = children.map((entry) => entry.node);
    const fields = new Map<string, LiquidNode>();
    for (const entry of children) {
      if (!fields.has(entry.field)) fields.set(entry.field, entry.node);
    }
    this.#fields = fields;
  }

  get children(): readonly LiquidNode[] {
    this.#materialize();
    return this.#children ?? [];
  }

  get childCount(): number {
    return this.children.length;
  }

  childForFieldName(name: string): LiquidNode | null {
    this.#materialize();
    return this.#fields?.get(name) ?? null;
  }

  descendantsOfType(type: string): readonly LiquidNode[] {
    const result: LiquidNode[] = [];
    const visit = (node: LiquidNode): void => {
      if (node.type === type) result.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return result;
  }
}

/** Depth-first cursor matching the `TreeCursor` members `walkFile` uses. */
class LiquidCursor {
  #node: LiquidNode;
  readonly #childIndex: number[] = [];

  constructor(root: LiquidNode) {
    this.#node = root;
  }

  get nodeType(): string {
    return this.#node.type;
  }

  get currentNode(): LiquidNode {
    return this.#node;
  }

  gotoFirstChild(): boolean {
    const [first] = this.#node.children;
    if (first === undefined) return false;
    this.#childIndex.push(0);
    this.#node = first;
    return true;
  }

  gotoNextSibling(): boolean {
    const parent = this.#node.parent;
    if (parent === null) return false;
    const index = (this.#childIndex.at(-1) ?? 0) + 1;
    const sibling = parent.children[index];
    if (sibling === undefined) return false;
    this.#childIndex[this.#childIndex.length - 1] = index;
    this.#node = sibling;
    return true;
  }

  gotoParent(): boolean {
    if (this.#node.parent === null) return false;
    this.#node = this.#node.parent;
    this.#childIndex.pop();
    return true;
  }
}

/**
 * Parse Liquid (+ embedded HTML) source into a walker-compatible tree.
 *
 * Throws `LiquidHTMLASTParsingError` on malformed input — callers map
 * this to `ParserError`.
 *
 * @since 0.2.0
 * @category constructors
 */
export function parseLiquidTree(source: string): Tree {
  const ast = toLiquidHtmlAST(source) as unknown as LiquidAstNode;
  const root = new LiquidNode(ast, source, lineOffsets(source), null);
  const tree = {
    rootNode: root as unknown as TSNode,
    walk: () => new LiquidCursor(root),
  };
  return tree as unknown as Tree;
}
