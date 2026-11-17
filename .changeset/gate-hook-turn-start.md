---
"@aurelienbbn/agentlint": patch
---

The `setup` hook adapter (`agentlint-gate.mjs`) now gates only what changed during the turn. A new `prompt` mode, registered as a `UserPromptSubmit` hook, records the working tree as each turn starts, and the Stop hook runs `check --all` only when the tree differs from that start. A pull, a commit or an edit made elsewhere between turns no longer hands its findings to a turn that only answered a question; edits and commits made during the turn, through any tool, still run the gate. Each conversation keeps its own state under `.agentlint/.cache/gate-hook/`, keyed by `session_id`, so sessions sharing a checkout no longer overwrite each other's. Without the `prompt` hook the Stop hook keeps its previous behavior. To pick this up, copy the new `agentlint-gate.mjs` over `.agentlint/hooks/agentlint-gate.mjs` and add the `UserPromptSubmit` entry from the `agentlint-setup` skill.
