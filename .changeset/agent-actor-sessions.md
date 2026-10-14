---
"@aurelienbbn/agentlint": minor
---

Codex with full filesystem access is recorded as `agent:codex`, no longer as the account's human, so it can no longer run `approve` (#74). Any runtime that sets `AI_AGENT` is recorded as `agent:<value>`.

A detected agent's actor now names the account it runs for and its session, so a decision leads back to its transcript: `agent:codex?session=<thread id>&user=<account>`. The text after `?` is URL query parameters; records written before stay valid as they are. `accept` and `propose` print the recorded actor.

`approve` refuses an assumed human outside a terminal, where an undetected agent looks the same. Run it in a terminal, use `agentlint review`, or declare the approver with `AGENTLINT_ACTOR=human:<name>`, as the GitHub action already does.
