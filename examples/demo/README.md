# agentlint demo

A small commerce application with seven repository-owned rules: query bounds, payment retries, focused tests, dynamic execution, customer-data exports, destructive migrations, and privilege widening. The fixture mixes state and change findings, agent and human authority, related reading context, dense rule groups, accepted work, an invalidated prior judgment, and delayed outcome evidence.

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

The queue spans API, background job, payment, test, privacy, and vendored code. Query, payment, and test rules permit agent acceptance. Customer-data exports and dynamic execution require a human. The seeded state shows three situations the review workspace is built for:

- **A finding needs repository context.** `customer-export.ts` links directly to the written customer-data export contract so the human reviews code and policy together.
- **An agent could not fix it.** `legacy-parser.js` calls `eval` in vendored code. The agent recorded a proposal without a diff explaining why it needs a product decision.
- **An agent already decided.** `reconcile-orders.ts` has a bounded-query finding the agent accepted with a concrete reason. It appears in **Decisions** with actor and time, where a human can request a correction.

## Decide

From the terminal:

```bash
pnpm agentlint explain <selector>
pnpm agentlint accept <selector> --reason "The endpoint has a verified finite tenant bound."
pnpm agentlint approve <selector> --reason "The requested fields and authorization path satisfy the linked privacy contract."
```

Use the selector printed by your latest check. `accept` cannot accept a human-authority finding. `approve` records human authority.

From the review workspace:

```bash
pnpm agentlint review --base origin/main
```

**Queue** lists what still needs a decision, grouped by file, with the code, the standard, and the agent's proposal. **Decisions** lists what is already accepted, by whom and when. Press `?` for the keyboard shortcuts. The final screen gives a copyable handoff for the coding agent.

Open **Customer-data exports follow the repository privacy contract** to QA related findings. Its detail view names `policy/customer-data-exports.md`; expand that file under **Related review context** and read the policy beside the primary finding. The rule deliberately declares both `dependencies` and `relatedFiles`: the dependency participates in finding identity, while `relatedFiles` selects the source the reviewer should see.

The same binding sets `reviewEpoch: 1`. Increment it only when the repository intentionally requires every otherwise-compatible decision for this rule to be revisited; the next review then explains that the repository advanced the epoch.

## Detached review

```bash
pnpm agentlint check --all --base origin/main --review-output agentlint-review.json
pnpm agentlint review --from agentlint-review.json
pnpm agentlint acceptances import agentlint-acceptances.jsonl --base origin/main
```

Detached review never writes to the repository. Import recomputes current findings and rejects stale or incompatible records.

## Acceptance lifetime

A formatting-only edit keeps a state acceptance. A material syntax edit invalidates it. A change acceptance is valid only for the exact versioned Git-change fingerprint. Run `check --all` to remove dead acceptance records. `.agentlint/acceptances.jsonl` holds only current accepted results. Git supplies the history.

## Inspect delayed outcomes

The demo includes committed observations in `.agentlint/outcomes.jsonl`. They describe what happened after earlier findings without changing the current gate:

```bash
pnpm agentlint outcomes list
pnpm agentlint outcomes list --format json
```

To add an observation for a current finding, use its queue selector:

```bash
pnpm agentlint outcomes record 1 --kind useful_interception --reference "issue:DEMO-101" \
  --note "The review caught an export field that was outside the privacy contract."
```

Outcome records are evidence for later rule calibration. They never accept a finding or open the gate.
