# agentlint 0.2 is a clean break

0.2 intentionally provides no automated migration from 0.1 development state. Delete the old ledger, notes configuration, presets, MCP or hook setup, and old rule shapes. Keep the repository standards worth enforcing and express them through the smaller model.

## Replace rules

Every configured rule is now one `defineRule` value with:

- `lifecycle: "state" | "change"`;
- a revisioned `standard`;
- a versioned `detector`;
- a repository `binding` with scope and authority;
- focused `mustReport` and `mustStaySilent` fixtures when useful.

Config uses a `rules` array. Core no longer ships presets or product rules.

## Replace dispositions

The old append-only `.agentlint/ledger.jsonl` and its deferred, no-fix, approval-requested, and approved states are gone. The only stored outcome is an acceptance in `.agentlint/acceptances.jsonl`. A current finding is either accepted or unresolved.

Do not translate old records automatically. Re-run the new detectors and make current decisions against the new fingerprints.

## Replace commands

| Removed 0.1 surface     | 0.2 surface                             |
| ----------------------- | --------------------------------------- |
| `resolve --accept`      | `accept <selector> --reason`            |
| `approve` over requests | `approve <selector> --reason`           |
| `ledger list/gc/review` | `acceptances list/clean/import`         |
| learned notes           | repository documentation or a rule      |
| MCP and Claude hook     | call the CLI from the harness           |
| bundled presets         | repository or third-party rule packages |

`check` has the same gate semantics locally and in CI. `--all` controls scan completeness, not strictness.

## Cut over

```bash
rm .agentlint/ledger.jsonl
pnpm agentlint init
pnpm agentlint rules test
pnpm agentlint rules scan --review
pnpm agentlint check --all
```

Review and commit the new config and any resulting acceptances. Read the [package guide](packages/agentlint/README.md) for the complete model.
