---
"@aurelienbbn/agentlint": minor
---

Reject configs where two rules share a standard id but differ in its revision, title, summary, source, or guidance. Loading fails with `ConfigError` reason `conflicting_standard`, naming the standard and both binding ids. Share one `standard` object between the rules. An optional field set to `undefined` counts as absent.
