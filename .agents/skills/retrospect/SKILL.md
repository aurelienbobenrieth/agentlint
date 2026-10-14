---
name: retrospect
description: Turn a recurring mistake or correction into the smallest durable fix, and route it to the right owner (type, lint rule, agentlint rule, conformance check, test, script, skill, or doc). Use when a retrospective is requested, the user corrects the same thing twice, or friction demonstrably repeats. Not appended to every finished task.
---

# Retrospect

- Evidence: conversation, commands, diffs, failures, corrections, artifacts. Missing history is a stated limit; never reconstruct it.
- Pick the costliest issue. Name trigger → agent action → consequence → correction.
- One isolated mistake ≠ universal rule. The user's communication style is never the defect.
- Owner by problem:
  - invalid state → type or schema that makes it unrepresentable
  - repeated deterministic violation → narrowest lint rule or conformance check
  - deterministic trigger, contextual verdict → agentlint rule (its `rule-advisor` skill authors it)
  - behavior → test
  - repeated commands, fragile verification → script ([toolsmith](../toolsmith/SKILL.md))
  - contextual judgment → focused skill: trigger + exception
  - missing domain decision → its canonical doc
  - conflicting process → remove or consolidate
  - one-off → fix the task, add nothing
- State benefit and maintenance cost before adding a tool or instruction.
- Assessment request → proposals only. "Improve the workflow" → local edits authorized without per-file asks; publishing still needs its own.
- Independent reviewer: give raw task and artifacts, not the expected answer. Agent agreement isn't proof.
- Validate against the original failure plus a nearby case that must stay unaffected. Skill edits: structural validity ≠ observed behavior.
- Handoff: top correction and evidence, what changed, how checked, what is still hypothesis. No session replay, no never-again promises.
