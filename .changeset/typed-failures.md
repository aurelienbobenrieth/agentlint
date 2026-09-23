---
"@aurelienbbn/agentlint": minor
---

Make every failure explicit and keep it off the gate verdict.

- `next` suggests actions with the full finding key instead of an ordinal. `next` never refreshed the ordinal cache, so `accept 1` could accept a different, still-current finding.
- An internal error exits 2 (usage, configuration, or internal error) instead of 1, which means unresolved findings.
- A detector hook that returns a promise (`async` visitors, `createOnce`, `before`, `after`, or `detect`) fails its rule. Such hooks used to report after the engine had collected findings, so the findings were silently lost.
- `defineRule` throws only `RuleDefinitionError` and `defineConfig` only `ConfigError`, now with the offending field, including for an invalid `match`, non-canonical options, and dependency paths. A detector that breaks the reporting contract fails with a `DetectorContractError` cause. `RuleDefinitionError`, `DetectorContractError`, and `FingerprintError` are exported, and `ChangeFixtureError` from `/testing`. Only a dependency the binding declares, not an inherited object key such as `toString`, counts as declared related context. A change detector's related files must be current paths in the change.
- `testRuleOnChange` and `testRuleFixtures` report change-detector failures as a typed rejection, like state detectors.
- A binding without a `reviewEpoch` keeps its previous binding digest.
- Change-set hunks no longer depend on the user's `diff.suppressBlankEmpty`, `diff.interHunkContext`, or `diff.renameLimit` Git settings.
- A grammar that cannot load, a parser trap, a lost store lock, an unreadable `.agentlint` directory, a truncated PR artifact, and an unknown `--rule` binding are typed errors with their cause. A failing existence probe no longer makes an outcome or proposal update rewrite the store with only the new record.
- An empty `AGENTLINT_ACTOR` is ignored, and the actor no longer requires a passwd entry when an agent or override is set.
- Explicit state globs accept either path separator, like change rules.
- The review UI withdraws a detached acceptance whose reason is cleared, encodes exported decisions through the contract schemas (`DetachedDecision` in `/contract`), shows server messages for rejected loads and finishes, and opens even when browser storage is blocked. The server logs why an editor could not open a file.
- The GitHub action handles patches of any size, clips annotations to GitHub's limits, falls back to the default bot identity only on authorization failures, and replies on the pull request when a command fails after its permission check.
