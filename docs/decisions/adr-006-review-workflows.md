# ADR-006: Review workflows

- Status: Accepted
- Date: 2026-08-10
- Depends on: [ADR-002](./adr-002-acceptance-model.md)
- Related to: [ADR-003](./adr-003-application-and-integrations.md), [ADR-005](./adr-005-fingerprints-and-lineage.md), [ADR-007](./adr-007-foldkit-review-spa.md)

## Decision

agentlint has two review workflows.

1. Calibration tests a detector before the repository enforces it.
2. Acceptance review resolves findings after enforcement.

Both workflows use the CLI or the optional local UI.

Local acceptance is a first-class 0.2 workflow. Provider-verified acceptance is a later adapter.

One local SPA serves attached review and detached CI artifacts.

An agent can propose a resolution. Only a human decision opens the gate for a human-authority finding.

## Context

An enabled finding needs a decision before the gate opens.

A small queue works well in the terminal. A large queue needs code context, guidance, filters, and grouping.

CI cannot wait for a browser on another computer.

Agents produce fixes faster than humans can read them. The human needs the agent's reasoning next to the code.

## Gate timing

Gate state and interruption timing are separate concerns.

Every unresolved enabled finding closes the final gate.

An integration can report a finding early and let the agent continue safe work. The final check must report every unresolved finding.

Do not call an early finding a non-blocking rule. The rule is enforced. The integration defers the review to a checkpoint.

Only `check --all` without file or rule filters is a complete view. A partial check cannot remove acceptances from unexamined files.

## Calibration

`agentlint rules scan --review` opens the UI in calibration mode.

Calibration runs the detector fixtures and scans the repository. It does not enable the detector and does not create acceptances. The server rejects an accept action in calibration mode.

The reviewer labels each match as `applies`, `does_not_apply`, or `unsure` and adds a note.

These labels are authoring feedback. They are not gate states. They stay in the browser session. The reviewer copies them as agent instructions when the review finishes.

The product does not create a candidate rule database from these labels. The final detector, binding, fixtures, and Git history preserve the result.

## Acceptance review

Acceptance review starts after an enabled detector reports a finding.

The reviewer can take one of these actions.

- Change the code until the finding disappears.
- Accept the exact finding with a reason.
- Request changes and send the agent back to work.
- Withdraw an earlier decision.

`agentlint accept` records an agent-authority acceptance. `agentlint approve` records a human-authority acceptance. Both write to `.agentlint/acceptances.jsonl` through the same handler.

`agentlint review` opens the UI. The **Queue** lists every finding that still needs a decision. The **Decisions** view lists accepted findings with the actor, the reason, and the time. A human can audit an agent acceptance there and withdraw it.

An acceptance needs a reason. When an agent proposal exists, the UI records the proposal summary as the reason if the reviewer gives none.

A request for changes needs no text. The finding message and the standard carry the instruction.

A changed finding needs a new review under [ADR-005](./adr-005-fingerprints-and-lineage.md). The server refuses an action when the finding changed or disappeared.

## Agent proposals

`agentlint propose <selector> --summary "..."` records what an agent did for one exact finding. An optional diff travels with the summary.

Proposals live in `.agentlint/proposals.jsonl`. They use the same source and fingerprint identity as acceptances.

The UI shows the proposal next to the code. A proposal is context for the decision. It never opens the gate.

## Attached and detached transport

The attached transport runs a loopback server with a session token. The server writes acceptances to the repository and records change requests in memory. The UI refetches server state after each action.

The detached transport starts from an artifact. `agentlint check --all --review-output <path>` writes the artifact in CI. `agentlint review --from <path>` opens it locally.

Detached decisions stay in the browser. The UI downloads accepted decisions as exact `AcceptanceRecord` JSONL. `agentlint acceptances import` rescans the repository and rejects a record whose finding changed, disappeared, or has different authority.

Detached review cannot claim that it changed repository state. The user imports, commits, and runs CI again.

Both transports end with a summary, agent instructions to copy, and acceptance output when it exists. The CLI prints the summary and the feedback after the browser finishes.

## Authority and verification

Authority answers who can accept a finding. Verification answers how the workflow supports that claim.

| Authority | Verification | Intended use                                            |
| --------- | ------------ | ------------------------------------------------------- |
| Agent     | Local        | Fast agent judgment with a committed reason             |
| Human     | Local        | Individual use and trusted local workflows              |
| Human     | Provider     | Team security through provider identity and permissions |

The 0.2 rule policy contains only `agent | human` authority. Local human acceptance is a workflow boundary. It does not prove human identity against a hostile local agent.

A future provider adapter can add proof metadata to the acceptance record. Provider metadata must not change finding or fingerprint semantics. Do not add a required verification policy before a provider adapter exists.

## Rejected alternatives

**Provider-only human acceptance.** This model gives stronger identity. It slows local work and excludes individual developers.

**Local acceptance as identity proof.** An unrestricted local agent can change repository files. The product must not claim a security guarantee that it cannot enforce.

**UI-only review.** This model makes browser interaction necessary for routine use. Small queues work better in the terminal.

**Permanent non-blocking rules.** This model lets enabled findings pass without a decision. Deferred interaction gives speed without a weaker final gate.

**Durable calibration database.** This model creates candidate lifecycle state and cleanup work. Git history already preserves the useful result.

**Automatic UI launch on a finding-count threshold.** The CLI must not open a browser without a user action. A person or an agent opens the UI when the terminal is not sufficient.

## Reconsideration conditions

Reconsider this record when a provider adapter ships, when an agent harness supports session continuation from the review server, or when detached review needs a second artifact version.

## Consequences

The UI has a defined optional role in calibration and acceptance.

Local acceptance stays fast for individual developers. Agent proposals give the human the reasoning without a chat transcript.

Provider verification can strengthen team workflows without a change to the core engine.

Version 0.2 does not resume an agent harness after review. The human pastes the copied instructions into the agent.

## Revision history

- 2026-08-10: The team proposed calibration, checkpoint review, and local acceptance as 0.2 workflows.
- 2026-08-10: The team accepted attached and detached review through one local SPA.
- 2026-08-28: Condensed and aligned with the 0.2 implementation.
