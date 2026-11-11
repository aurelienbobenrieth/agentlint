---
"@aurelienbbn/agentlint": minor
---

The packaged skills are renamed so an installed skill shows which package it belongs to: `usage` is now `agentlint-usage`, `setup` is now `agentlint-setup`, and `rule-advisor` is now `agentlint-rule-advisor`. Their folders move with them, so the Stop hook adapter now ships at `skills/agentlint-setup/agentlint-gate.mjs`. Reinstall the skills to pick up the new names and remove the old `usage`, `setup`, and `rule-advisor` copies. An already copied `.agentlint/hooks/agentlint-gate.mjs` keeps working.
