# agentlint 0.2 demo

This demo shows the full product loop against a small commerce application. Six repository-owned rules cover query bounds, payment retries, focused tests, dynamic execution, destructive migrations, and privilege widening. The fixture deliberately mixes state and change findings, agent and human authority, dense rule groups, accepted work, and an invalidated prior judgment.

The package supplies the engine and review tools. The repository supplies every rule.

## Prepare

```bash
pnpm install
pnpm build
cd examples/demo
```

## Prove the rules

```bash
node ../../packages/agentlint/dist/bin.mjs rules test
```

Each detector has `mustReport` fixtures and `mustStaySilent` fixtures. These examples define the detection boundary. They do not try to list every bad program.

## Calibrate on the repository

Before enforcing a new rule, scan real repository code and review every match:

```bash
node ../../packages/agentlint/dist/bin.mjs rules scan --rule data/bounded-queries --review
```

The calibration workspace lets a rule author label each match as applies, does not apply, or unsure. These temporary labels do not accept findings and do not change the gate. They expose false positives, missing context, and binding mistakes while the rule is still cheap to revise.

Use the results to refine the detector, repository binding, standard guidance, and representative fixtures. Run `rules test` again, then repeat the repository scan until the evidence is useful enough to enforce.

## Run the gate

```bash
node ../../packages/agentlint/dist/bin.mjs check --all --base origin/main
```

The demo produces a realistic review queue across API, background job, payment, test, migration, page, and vendored code. Some rules produce several findings so grouping, filtering, and full-file source navigation are visible in the workspace.

Query, payment, and test rules permit agent acceptance. Dynamic execution, migration, and authorization rules require human acceptance. The seeded state shows the three situations the review UI is built for:

- **An agent fixed it and asks for sign-off.** `2026-06-drop-legacy-flag.ts` drops a column. The agent added a backfill and recorded a proposal with the diff (`agentlint propose`). The human reads the diff next to the evidence and accepts or requests changes.
- **An agent could not fix it.** `legacy-parser.js` calls `eval` in vendored code. The agent recorded a proposal without a diff explaining why it needs a product decision.
- **An agent already decided.** `reconcile-orders.ts` has a bounded-query finding the agent accepted with a concrete reason. It appears in **Decisions** with actor and time, where a human can request a correction.

`2026-07-drop-legacy-users.ts` is accepted by a human and also appears in **Decisions**.

## Use the text loop

```bash
node ../../packages/agentlint/dist/bin.mjs check --all
node ../../packages/agentlint/dist/bin.mjs explain 2
node ../../packages/agentlint/dist/bin.mjs accept 2 --reason "The endpoint has a verified finite tenant bound."
node ../../packages/agentlint/dist/bin.mjs approve 7 --reason "Backup, rollback, and deployment order are verified."
```

`accept` cannot accept a human-authority finding. `approve` records human authority. `propose <selector> --summary "..." [--diff-file path]` records agent work on a finding it cannot accept.

## Use the review workspace

```bash
node ../../packages/agentlint/dist/bin.mjs review --base origin/main
```

**Queue** lists what still needs a decision, grouped by file. Each finding shows the code, why it was flagged, the agent's proposal when there is one, and a single reason field with **Accept** / **Request changes**. **Decisions** lists what is already accepted, by whom and when; a human can request a correction on an agent acceptance. Search, the filter popover (status, authority, rule, group by file or rule), and the active-filter chips keep large queues manageable. The final screen gives a copyable handoff for the coding agent.

## Use a detached CI review

```bash
node ../../packages/agentlint/dist/bin.mjs check --all --base origin/main --review-output agentlint-review.json
node ../../packages/agentlint/dist/bin.mjs review --from agentlint-review.json
```

Detached review does not write to the source repository. Export the accepted decisions and import them after checkout:

```bash
node ../../packages/agentlint/dist/bin.mjs acceptances import agentlint-acceptances.jsonl --base origin/main
```

The import recomputes current findings. It rejects stale or incompatible records.

## Test acceptance lifetime

A formatting-only edit keeps a state acceptance when the matched syntax has the same semantic structure. A material syntax edit invalidates it.

A change acceptance is valid only for the exact versioned Git-change fingerprint. A later material change creates a new unresolved finding. The old reason can appear as context, but it cannot open the gate.

Run a complete check to remove dead acceptance records:

```bash
node ../../packages/agentlint/dist/bin.mjs check --all --base origin/main
```

The committed file `.agentlint/acceptances.jsonl` contains only current accepted results. Git supplies its history.
