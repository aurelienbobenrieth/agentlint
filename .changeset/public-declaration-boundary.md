---
"@aurelienbbn/agentlint": patch
---

Separate public parser errors and fixture contracts from parser implementation modules. Packed public declarations no longer import tree-sitter's internal Emscripten types, allowing strict consumers to typecheck without skipLibCheck or ambient parser declarations.
