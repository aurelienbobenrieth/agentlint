---
"@aurelienbbn/agentlint": minor
---

Move the project config file to `.agentlint/config.ts`.

This is a breaking change: root-level `agentlint.config.*` files are no longer discovered, and `agentlint init` now creates `.agentlint/config.ts`.
