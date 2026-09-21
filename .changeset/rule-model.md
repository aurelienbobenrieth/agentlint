---
"@aurelienbbn/agentlint": minor
---

Replace the 0.1 rule shapes with one `defineRule` discriminated union. A rule composes a revisioned `standard`, a versioned `detector`, and a repository-owned `binding` with scope, options, and `agent` or `human` authority. `lifecycle: "state"` judges current source with parsed `pattern`/`query` matches or a `createOnce` visitor; `lifecycle: "change"` judges normalized Git evidence. Detectors declare focused `mustReport` and `mustStaySilent` fixtures, run by `agentlint rules test` and the exported `testRuleFixtures` helpers. The core ships no rules or presets.
