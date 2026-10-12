---
"@aurelienbbn/agentlint": patch
---

A `match.pattern` now requires the operators and keywords it spells out. `$A === $B` matched `a <= b`, `a !== b`, and `a == b`; `let $X = $V` matched `const`; and `typeof $X`, `await $X`, or `!$X` matched every identifier. Punctuation a formatter changes (commas, semicolons, parentheses, quote style) still never matters.

Rules built on such patterns report fewer findings. A pattern led by a keyword, such as `const $X = $V`, now reports the whole declaration instead of its declarator, so its accepted findings reopen once under a new fingerprint.
