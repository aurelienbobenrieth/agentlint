---
"@aurelienbbn/agentlint": minor
---

Rework the CLI around the acceptance model: `check [--all] [--base] [--rule] [--format text|jsonl] [--review-output]`, `accept` (agent authority), `approve` (human authority), `propose --summary [--diff-file]` to attach agent work to a finding it cannot accept, `explain`, `rules list|test|scan [--review]`, `acceptances list|clean|import`, and `init`. Exit code `0` means the gate is open, `1` unresolved findings, `2` invalid usage or configuration. Local and CI checks share the same semantics.
