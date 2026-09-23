# Public API

**Four entry points, no bundled standards, detectors, rules, or presets. Rule authors never construct engine services or import Effect.**

| Import                               | Exports                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@aurelienbbn/agentlint`             | `defineConfig`, `defineRule`, rule and config types, detector contexts, change evidence and outcome schemas, tagged errors |
| `@aurelienbbn/agentlint/testing`     | Promise-based fixture helpers                                                                                              |
| `@aurelienbbn/agentlint/contract`    | Review wire contract, including `NextResult`                                                                               |
| `@aurelienbbn/agentlint/calibration` | Calibration report schemas and pure helpers                                                                                |

## Rule and config authoring

| Kind            | Names                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functions       | `defineConfig`, `defineRule`                                                                                                                                      |
| Types           | `AgentlintConfig`, `AgentlintRule`, `StateRule`, `ChangeRule`, `RuleBinding`, `RuleStandard`, `Guidance`, `RuleMatch`, `Visitors`                                 |
| Detector types  | `RuleContext` (`absolutePath`, `path`, `source`, `dependencies`, `report`), `ChangeRuleContext`, `AgentlintNode`, `TreeSitterNodeType`                            |
| Runtime schemas | `ChangeSet`, `ChangedFile`, `ChangeHunk`, `ChangeLine`, `FileSnapshot`, `ChangeBaseline`, `FindingRecord`, `OutcomeKind`, `OutcomeRecord`, to construct or decode |
| Tagged errors   | `RuleDefinitionError`, `ConfigError`, `DetectorContractError`, `FingerprintError`, `PatternError`, `ParserError`                                                  |

`defineRule` throws only `RuleDefinitionError`; `defineConfig` throws only `ConfigError`. What each error means: [guarantees](guarantees.md#failures-are-typed).

Detectors report synchronously. Breaking the reporting contract or returning a promise from a hook fails the rule with a `DetectorContractError` cause; see the [detector contract](writing-rules.md#imperative-detectors-are-trusted-code-with-a-synchronous-contract).

## Testing helpers

`@aurelienbbn/agentlint/testing` runs fixtures from your own test runner.

| Export                                                  | Use                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `testRuleFixtures`                                      | Run a rule's activation and silence fixtures with real parsing                                |
| `testRuleOnSource`                                      | Run a state rule on one in-memory snippet; `file` (default `fixture.tsx`) selects the grammar |
| `testRuleOnSources`                                     | Run a state rule on `[path, source]` pairs, including all declared dependencies               |
| `testRuleOnChange`                                      | Run a change rule on compact before/after repositories or an exact `ChangeSet`                |
| `normalizeChangeFixture`                                | Turn a compact change fixture into a `ChangeSet`                                              |
| `ChangeFixtureError`, `FixtureReport`, `FixtureFailure` | Failure and result types                                                                      |

- Every helper reports detector failures as a rejected promise.
- Compact change fixtures diff actual lines with three context lines. For very large fixtures or precise rename evidence, pass an explicit `ChangeSet`.
- Fixtures test activation; calibrate file scope against a repository with `rules scan`.

## Wire contract and calibration

- `@aurelienbbn/agentlint/contract` holds the review wire contract. Decode `agentlint next --format json` with `NextResult`.
- `@aurelienbbn/agentlint/calibration` holds the version 1 calibration report schemas and pure helpers used by `rules calibration`.
