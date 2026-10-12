---
"@aurelienbbn/agentlint": patch
---

A TypeScript or TSX file that its grammar rejects is parsed again with the other bundled build of tree-sitter-typescript, and the check fails only when both reject it. Before, a `.ts` file holding a regex that starts with `<!--` (`/<!--/`) or a `.tsx` file holding a tagged template with an object type argument (`` sql<{ id: string }>`…` ``) failed the whole check with "Parse failed: syntax is incomplete or unsupported by the grammar". Files that parsed before keep their syntax tree, so their fingerprints and acceptances do not change.
