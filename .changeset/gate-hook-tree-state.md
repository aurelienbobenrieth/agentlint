---
"@aurelienbbn/agentlint": patch
---

The `setup` Stop hook (`agentlint-gate.mjs`) now decides whether to run the gate from the working tree instead of the agent transcript. It runs `check --all` whenever HEAD, `git status` (untracked files included), or the content of a changed file differs from the last state it judged, so files changed through a shell (`sed`, heredocs, scripts) are now gated. A stop over an unchanged tree reuses the recorded verdict silently, so a closed gate is reported once. The state lives in `.agentlint/.cache/gate-hook.json`. Without git the gate runs on every stop. Copy the new `agentlint-gate.mjs` over `.agentlint/hooks/agentlint-gate.mjs` to pick this up.
