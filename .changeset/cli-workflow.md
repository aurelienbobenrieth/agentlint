---
"@aurelienbbn/agentlint": minor
---

Rework the CLI around the acceptance workflow.

- `check [files...] [--all] [--base] [--rule] [--format text|jsonl] [--review-output]` runs the gate. Exit `0` means the gate is open, `1` means unresolved findings, and `2` means invalid usage, configuration, evidence, or an internal error. `--format jsonl` writes only finding records to stdout.
- `next` hands an agent one current obligation as versioned JSON, with the full finding key, evidence, authority, and argument arrays.
- `accept` records an agent acceptance and `approve` a human one, each with a reason. `propose --summary [--diff-file]` attaches agent work to a finding the agent cannot accept.
- `explain` shows the standard and guidance behind a rule or finding.
- `rules list|test|scan [--review]|calibration`, `acceptances list|clean|import`, and `outcomes` manage rules, calibration, acceptances, and delayed outcome records.
- Git failures explain their fix: a shallow clone, a missing default branch, a base ref starting with `-`, or a missing `git` executable. Change evidence does not depend on the user's diff settings or locale.
- The config loader resolves `@aurelienbbn/agentlint` and its subpaths to the running copy, so `npx --yes @aurelienbbn/agentlint check` works in a repository that never installed it.
