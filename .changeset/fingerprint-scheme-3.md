---
"@aurelienbbn/agentlint": minor
---

State fingerprints move to `source-structure` version 3. Sources and binding dependencies are now read with LF line endings, so a CRLF checkout and an LF checkout of the same commit agree, and source text that a grammar exposes as no node (the literal parts of a template literal type, for example) is now evidence instead of being dropped. A stored acceptance with an older fingerprint version remains readable but no longer opens a gate: decide those findings again.

A pattern or query only has to compile for one of the grammars its binding covers. Files of a grammar that cannot read it are skipped for that match instead of aborting the run; a match that compiles for no grammar in scope still fails. Matching no longer recurses over the target file, so deeply nested code cannot exhaust the stack.
