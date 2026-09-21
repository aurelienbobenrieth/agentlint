---
"@aurelienbbn/agentlint": minor
---

Ship the FoldKit review application inside the package and serve it with `agentlint review` on loopback behind a session token. The **Queue** lists findings that still need a decision, grouped by file, with the agent's proposal next to the evidence; **Decisions** lists what is accepted, by whom and when, and lets a human request a correction. Keyboard-first navigation, filters, search, and a copyable handoff for the coding agent. `check --review-output` writes a detached artifact that `review --from` opens without a repository, exporting acceptances for `acceptances import`. Detected editors open findings at the exact position.
