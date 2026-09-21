import type { Node as TreeSitterNode, Tree } from "web-tree-sitter";

/**
 * Walk a tree without recursion and expose each node's structural path from the root.
 */
export function walkTree(tree: Tree, visit: (node: TreeSitterNode, position: readonly number[]) => void): void {
  const cursor = tree.walk();
  const position: number[] = [];

  try {
    for (let reachedEnd = false; !reachedEnd;) {
      visit(cursor.currentNode, position);

      if (cursor.gotoFirstChild()) {
        position.push(0);
        continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) {
          reachedEnd = true;
          break;
        }
        position.pop();
      }
      if (!reachedEnd) position[position.length - 1] = (position.at(-1) ?? 0) + 1;
    }
  } finally {
    cursor.delete();
  }
}
