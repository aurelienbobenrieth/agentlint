# Validate a review obligation

Use this worksheet for an individual developer or a small team. Keep the evidence in your repository or normal review notes. The engine needs no telemetry.

## Choose one recurring question

- Original review comment or required decision:
- Repository standard and permitted cases:
- Deterministic trigger and files in scope:
- Authority required:
- Supporting files that must invalidate a decision when changed:
- Rule owner:

Start with a real correction. Prefer a test, type or conventional lint check when the answer is mechanically decidable.

## Calibrate before enabling

1. Create one rule and focused activation and silence fixtures.
2. Include fixtures that change a guard, a supporting file, a duplicate occurrence and formatting.
3. Run `agentlint rules test` and `agentlint rules scan --review`.
4. Examine every match. Refine or remove an unreliable trigger before enabling it.
5. Commit the rule and explain its scope to the other developers.

## Compare actual work

For a representative set of tasks, compare normal repository instructions, explicitly surfaced standards, and the acceptance gate. Use comparable tasks or replayable task snapshots. Have a developer assess results without treating an agent's acceptance as proof of correctness.

| Task | Setup | Missed concerns | Useful interceptions | Unnecessary reviews | Human review minutes | Rule maintenance minutes |
| ---- | ----- | --------------- | -------------------- | ------------------- | -------------------- | ------------------------ |
|      |       |                 |                      |                     |                      |                          |

Include the cost of initial rule authoring and repeated invalidations. Count a stored acceptance as a decision, not as a prevented defect.

## Decide whether the rule earns its place

- Which obligation became reliably visible?
- Which decisions saved a repeated discussion?
- Did the total review and maintenance effort decrease?
- Did an acceptance survive a change that should have invalidated it?
- Did a harmless change cause excessive review work?
- Keep, refine or remove the rule, with a short reason.

Expand only after this evidence shows that the first obligation is useful. The same process works for a personal rule and for a shared team standard.
