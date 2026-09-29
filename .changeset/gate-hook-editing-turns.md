---
"@aurelienbbn/agentlint": patch
---

The `setup` Stop hook (`agentlint-gate.mjs`) now gates only a turn that edited files. A question or a review asked after earlier coding ends normally instead of being handed the open findings, which are often another agent's work in progress. Codex edits made through code mode's `exec` tool (an `apply_patch` inside its input) now count as edits. Copy the new `agentlint-gate.mjs` over `.agentlint/hooks/agentlint-gate.mjs` to pick this up.
