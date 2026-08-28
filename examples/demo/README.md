# agentlint demo

A small commerce application with six repository-owned rules: query bounds, payment retries, focused tests, dynamic execution, destructive migrations, and privilege widening. The fixture mixes state and change findings, agent and human authority, dense rule groups, accepted work, and an invalidated prior judgment.

The package supplies the engine and the review tools. This repository supplies every rule. See [`.agentlint/config.ts`](.agentlint/config.ts).

## Prepare

```bash
pnpm install
pnpm build
cd examples/demo
```

Every command below runs through `pnpm agentlint`, which points at the workspace build.

## Prove the rules

```bash
pnpm agentlint rules test
```

Each detector has `mustReport` and `mustStaySilent` fixtures. They define the detection boundary. They do not try to list every bad program.

## Calibrate before enforcing

```bash
pnpm agentlint rules scan --rule data/bounded-queries --review
```

The calibration workspace lets a rule author label each match as applies, does not apply, or unsure. Labels are temporary. They never accept a finding and never change the gate. Use them to refine the detector, binding, guidance, and fixtures, then run `rules test` again.

## Run the gate

```bash
pnpm agentlint check --all --base origin/main
```

The queue spans API, background job, payment, test, migration, page, and vendored code. Query, payment, and test rules permit agent acceptance. Dynamic execution, migration, and authorization rules require a human. The seeded state shows the three situations the review workspace is built for:

- **An agent fixed it and asks for sign-off.** `2026-06-drop-legacy-flag.ts` drops a column. The agent added a backfill and recorded a proposal with the diff (`agentlint propose`). The human reads the diff next to the evidence and accepts or requests changes.
- **An agent could not fix it.** `legacy-parser.js` calls `eval` in vendored code. The agent recorded a proposal without a diff explaining why it needs a product decision.
- **An agent already decided.** `reconcile-orders.ts` has a bounded-query finding the agent accepted with a concrete reason. It appears in **Decisions** with actor and time, where a human can request a correction.

`2026-07-drop-legacy-users.ts` is accepted by a human and also appears in **Decisions**.

## Decide

From the terminal:

```bash
pnpm agentlint explain 2
pnpm agentlint accept 2 --reason "The endpoint has a verified finite tenant bound."
pnpm agentlint approve 7 --reason "Backup, rollback, and deployment order are verified."
```

`accept` cannot accept a human-authority finding. `approve` records human authority.

From the review workspace:

```bash
pnpm agentlint review --base origin/main
```

**Queue** lists what still needs a decision, grouped by file, with the code, the standard, and the agent's proposal. **Decisions** lists what is already accepted, by whom and when. Press `?` for the keyboard shortcuts. The final screen gives a copyable handoff for the coding agent.

## Detached review

```bash
pnpm agentlint check --all --base origin/main --review-output agentlint-review.json
pnpm agentlint review --from agentlint-review.json
pnpm agentlint acceptances import agentlint-acceptances.jsonl --base origin/main
```

Detached review never writes to the repository. Import recomputes current findings and rejects stale or incompatible records.

## Acceptance lifetime

A formatting-only edit keeps a state acceptance. A material syntax edit invalidates it. A change acceptance is valid only for the exact versioned Git-change fingerprint. Run `check --all` to remove dead acceptance records. `.agentlint/acceptances.jsonl` holds only current accepted results. Git supplies the history.
