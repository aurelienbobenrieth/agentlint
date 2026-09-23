---
"@aurelienbbn/agentlint": minor
---

**Breaking:** the project config moves to `.agentlint/config.ts`. Root-level `agentlint.config.*` files are no longer discovered, and `agentlint init` now creates `.agentlint/config.ts`. Move an existing config file into `.agentlint/`.
