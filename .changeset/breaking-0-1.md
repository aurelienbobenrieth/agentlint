---
"@aurelienbbn/agentlint": minor
---

**Breaking:** 0.2 is a clean break from the 0.1 prerelease. There is no automated migration. Delete `.agentlint/ledger.jsonl`, the notes configuration, presets, and the MCP or hook setup, then run `agentlint init`, express the standards worth keeping with `defineRule`, and record fresh acceptances. Learned notes, the MCP server, the Claude hook, and the separate UI package are removed from the core.
