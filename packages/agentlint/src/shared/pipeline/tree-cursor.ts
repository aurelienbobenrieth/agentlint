import type { Node as TreeSitterNode, Tree } from "web-tree-sitter";

/**
 * Walk a tree without recursion and expose each node's structural path from the root.
 */
export function walkTree({
  tree,
  visit,
}: {
  readonly tree: Tree;
  readonly visit: (input: { readonly node: TreeSitterNode; readonly position: readonly number[] }) => void;
}): void {
  const cursor = tree.walk();
  const position: number[] = [];

  try {
    walk: for (;;) {
      visit({ node: cursor.currentNode, position });

      if (cursor.gotoFirstChild()) {
        position.push(0);
        continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) break walk;
        position.pop();
      }
      position[position.length - 1] = (position.at(-1) ?? 0) + 1;
    }
  } finally {
    cursor.delete();
  }
}
