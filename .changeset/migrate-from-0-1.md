---
"@aurelienbbn/agentlint": minor
---

**Breaking:** 0.2 replaces the 0.1 flag-and-review workflow with an acceptance gate. There is no automated migration.

1. Delete `.agentlint-state`. Reviewed hashes are not carried over; record fresh acceptances with `agentlint accept` or `agentlint approve`.
2. Move `agentlint.config.*` to `.agentlint/config.ts`. Root-level config files are no longer discovered, and `agentlint init` creates `.agentlint/config.ts`.
3. Rewrite each rule with `defineRule`. `meta.name`, `languages`, `instruction`, `include`, and `ignore` become a revisioned `standard`, a versioned `detector`, and a `binding` with scope and authority. `rules` in `defineConfig` is an array, and the config `include`/`ignore` keys become `ignores`.
4. In detectors, replace `context.flag()` with `context.report()`, and `getFilename()` and `getSourceCode()` with the `absolutePath`, `path`, and `source` properties. `getLinesAround()` is removed.
5. Rename types: `AgentReviewConfig` → `AgentlintConfig`, `AgentReviewRule` → `AgentlintRule`, `AgentReviewNode` → `AgentlintNode`, `FlagOptions` → `FindingOptions`, `FlagRecord` → `FindingRecord`. `RuleMeta` is removed, and `Position` is exported as a type only.
6. Update CLI calls: `list` → `rules list`; `review <hash...>`, `review --all`, and `review --reset` → `accept`/`approve` with a reason, or the review UI; `check --dry-run` and the `-a`, `-r`, and `-d` aliases are removed. `--help` is generated for every command, `--rule` can repeat, and usage errors exit `2`.
