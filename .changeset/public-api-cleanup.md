---
"@aurelienbbn/agentlint": minor
---

Narrow the public API to what a rule or config author needs and move the testing helpers to a subpath.

- `@aurelienbbn/agentlint/testing` now exports `testRuleFixtures`, `testRuleOnSource`, `testRuleOnChange`, the Effect runners `runRuleFixtures`, `runRuleOnSource`, `runRuleOnSources`, `runRuleOnChange`, `normalizeChangeFixture`, and the `FixtureReport` and `FixtureFailure` types. They are no longer exported from the package root.
- `testRuleOnChange(rule, fixture)` accepts a `ChangeFixture` and returns `FindingRecord`s, the same shape `agentlint check` produces. `ReportedChangeFinding` is gone.
- Removed from the root: `normalizeConfig`, `NormalizedConfig`, `compactStandard`, `normalizeGuidance`, `NormalizedGuidance`, `ruleMatches`, `ruleId`, `RuleGuidance`, `FindingOptions`. `RuleAuthority`, `Position`, and the rule schemas other than the change evidence set are exported as types only.
- `RuleContext` exposes `absolutePath`, `path`, and `source` properties instead of `getFilename()`, `getFilePath()`, and `getSourceCode()`. `getLinesAround` is removed.
- `Visitors` is `VisitorHooks & Partial<Record<TreeSitterNodeType, VisitorHandler>>`; unknown node names are no longer accepted.
- `defineRule` and `defineConfig` throw tagged `RuleDefinitionError` and `ConfigError` with structured `reason` fields instead of plain `Error`.
- New `Lifecycle` type. `RuleAuthority` is the single source for `"agent" | "human"`.
- Fixture snapshots use SHA-256 digests, matching Git evidence.
