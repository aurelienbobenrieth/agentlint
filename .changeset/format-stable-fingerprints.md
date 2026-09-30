---
"@aurelienbbn/agentlint": minor
---

Reformatting no longer reopens accepted state findings. State fingerprints move to `source-structure` v4, which ignores what a formatter rewrites: line breaks, trailing commas, semicolons, quote style and escapes, redundant parentheses, `(x) =>` vs `x =>`, a union's leading `|`, number spelling, `"key"` vs `key`, `new Foo` vs `new Foo()`, JSX line breaks and `{" "}`, and comment layout. Identifiers, literal values, operators, and the tree shape still invalidate a decision. On 87 real files reformatted with oxfmt and Prettier, a print width of 80 or 120 changed 82 to 86% of v3 state fingerprints, and another quote, semicolon, or trailing-comma setting changed all of them; v4 changed none.

Existing decisions carry over without a new review. A `source-structure` v3 acceptance or proposal keeps opening the gate while it equals the v3 fingerprint the engine computes for the finding now, and the first `check --all` moves it to v4 with its reason, actor, and date ("N acceptances moved to the current evidence fingerprint"). Run that check once after upgrading, before reformatting: a reformat first changes the v3 fingerprint, and those decisions are asked for again. Detached artifacts from earlier versions still import. Change rules are unaffected: their `git-change` evidence is whatever the detector reports.
