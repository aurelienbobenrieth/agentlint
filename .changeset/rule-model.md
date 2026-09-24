---
"@aurelienbbn/agentlint": minor
---

Define rules as one `defineRule` discriminated union. A rule composes a revisioned `standard`, a versioned `detector`, and a repository-owned `binding` with scope, typed options, declared dependencies, an optional `reviewEpoch`, and `agent` or `human` authority. The core ships no rules or presets.

- `lifecycle: "state"` judges current source with declarative `pattern` and `query` matches or a synchronous `createOnce` visitor. A placeholder repeated in a pattern must capture the same code, overlapping matches report each node once, and a match only has to compile for one grammar in the binding's scope.
- `lifecycle: "change"` judges a normalized `ChangeSet` (file status, before and after snapshots, hunks) computed from the merge base of the detected or `--base` ref and the complete working tree, including staged, unstaged, and untracked files. Change detectors report a stable `key`, material `evidence`, and an optional `lineageKey`.
- Detectors declare `mustReport` and `mustStaySilent` fixtures, run by `agentlint rules test` and by the promise helpers in `@aurelienbbn/agentlint/testing`: `testRuleFixtures`, `testRuleOnSource`, `testRuleOnSources`, `testRuleOnChange`, and `normalizeChangeFixture`. Each helper takes one named-argument object and rejects on detector failure.
- `defineRule` throws only `RuleDefinitionError` and `defineConfig` only `ConfigError`, each naming the offending field. A detector that returns a promise or breaks the reporting contract fails its rule with a `DetectorContractError` cause. `FingerprintError`, `PatternError`, and `ParserError` are exported, and `ChangeFixtureError` from `/testing`.
- The public visitor type covers every packaged grammar node, including the JSON document root, and unknown node names are rejected. Packed declarations no longer depend on tree-sitter's internal types, so strict consumers typecheck without `skipLibCheck`.
- Configs compose with `extends`, and `agentlint init --preset` composes repository-owned plugin presets.
