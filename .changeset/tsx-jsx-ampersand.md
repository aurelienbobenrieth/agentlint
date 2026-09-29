---
"@aurelienbbn/agentlint": minor
---

TSX files parse with tree-sitter-typescript 0.23.2 instead of its 0.20 build in tree-sitter-wasms, which rejected a `&` inside a JSX string attribute, such as Tailwind's `className="[&_svg]:size-4"`, and failed the check with "Parse failed: syntax is incomplete or unsupported by the grammar". TypeScript files stay on 0.20: 0.23.2 rejects a tagged template with an object type argument (`` sql<{ id: string }>`…` ``). In TSX, a fragment (`<>…</>`) is now a `jsx_element` without a tag name, so `jsx_fragment` is gone from the node types.

Upgrading can close the gate once. A state fingerprint digests its whole file's syntax tree, so a TSX file the two grammars parse differently gives its findings new fingerprints: their acceptances become stale and are removed, and the findings need accepting again. TypeScript, JavaScript, and JSON fingerprints do not change.
