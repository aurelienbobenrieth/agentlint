---
"@aurelienbbn/agentlint": patch
---

A tagged template holding a `\u` or `\x` that starts no escape now parses, so `` String.raw`C:\users\me` `` no longer fails the whole check with "Parse failed: syntax is incomplete or unsupported by the grammar". Rules, patterns, and queries still read the file's own text. Files that parsed before keep their syntax tree, so their fingerprints and acceptances do not change.
