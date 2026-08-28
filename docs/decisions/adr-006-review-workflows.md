# ADR-006: Review workflows

- Status: Accepted
- Date: 2026-08-10
- Depends on: [ADR-002](./adr-002-acceptance-model.md)
- Related to: [ADR-003](./adr-003-application-and-integrations.md)

## Decision

agentlint has two review workflows:

1. Calibration reviews a detector before repository enforcement.
2. Acceptance review resolves findings after enforcement.

Both workflows can use text or the optional local UI.

Local acceptance is a first-class 0.2 workflow.

Provider-verified acceptance is a later adapter. It is not necessary for local or individual use.

The same SPA supports attached local review and detached CI artifacts.

## Interaction timing

Gate state and interruption timing are separate concerns.

Every unresolved enabled finding closes the final gate.

An early check can report a finding and let the agent continue safe work.

The completion check must report all unresolved findings.

The supported workflow must not complete while an unresolved finding stays hidden.

Do not call an early finding a non-blocking rule.

The rule is enforced. The integration defers the review interaction to a checkpoint.

## Calibration workflow

Calibration tests a draft detector against an existing repository.

Calibration does not enable the detector and does not create acceptances.

A calibration run performs these steps:

1. Run detector fixtures.
2. Scan the selected repository scope.
3. Show all matches.
4. Collect review notes for important matches.
5. Send structured feedback to the authoring agent.
6. Change detector code, configuration, guidance, or fixtures.
7. Repeat the scan.
8. Enable the final binding through a normal code change.

Calibration review can mark a match with these temporary labels:

- Applies.
- Does not apply.
- Needs different scope.
- Needs different guidance.
- Needs investigation.

These labels are authoring feedback. They are not gate states.

The product must not create a candidate rule database from these labels.

A reviewed non-applicable match can motivate a `mustStaySilent` fixture.

The tool must not create that fixture automatically without author confirmation.

## Calibration UI

The UI can make calibration useful when a detector finds many cases.

The UI can show these items:

- Repository code context.
- The standard and current guidance.
- The detector and binding identity.
- Filters and grouping.
- Temporary review labels.
- Reviewer notes.
- A structured feedback summary.

The UI does not edit detector code directly in 0.2.

The authoring agent applies the feedback to code, configuration, guidance, and fixtures.

The final repository change remains reviewable in Git.

## Acceptance review

Acceptance review starts after an enabled detector reports a finding.

The reviewer can take one of these actions:

- Change the code until the finding disappears.
- Accept the exact finding with a reason.
- Give feedback that sends the agent back to work.

An approval request does not open the gate.

An acceptance must satisfy the binding authority.

## Local agent acceptance

An agent-authority binding permits local agent acceptance.

The agent must include a reason based on applicable evidence.

The acceptance enters the repository acceptance file.

CI validates the finding, fingerprint, and authority with the same semantics.

Local acceptance does not defeat the gate. It is the intended fast decision path for agent-authority findings.

## Local human acceptance

A human-authority binding permits a person to accept through an interactive local surface.

The surface can be terminal text or the local UI.

The human gives a reason. The surface writes the acceptance through a shared application handler.

The acceptance file records a local human authority path.

This path is a workflow boundary. It does not prove human identity against a hostile local agent.

## Provider acceptance

A provider adapter can give stronger identity and permission evidence.

For example, a GitHub or GitLab bot can perform these steps:

1. Publish structured findings and agent reasoning.
2. Receive an explicit reviewer command or action.
3. Verify repository permissions or ownership rules.
4. Create a signed or provider-backed acceptance receipt.
5. Run the common acceptance validation path.

Provider verification must not change finding or fingerprint semantics.

Provider proof metadata must be additive to the core acceptance record.

The 0.2 core must not require a provider account or hosted service.

## Detached CI review

CI can produce a portable review artifact for unresolved findings.

A human can open the artifact in the local review SPA.

The SPA can produce acceptance output and structured feedback.

The SPA also provides copyable agent instructions.

The human can paste feedback into any coding agent.

Detached review cannot claim that it changed repository state remotely.

The user applies or commits acceptance output and runs CI again.

CI must not wait indefinitely for a browser on another computer.

## Authority and verification

Authority answers who can accept a finding.

Verification answers how the workflow supports that claim.

The concepts are separate:

| Authority | Verification | Intended use                                            |
| --------- | ------------ | ------------------------------------------------------- |
| Agent     | Local        | Fast agent judgment with a committed reason             |
| Human     | Local        | Individual use and trusted local workflows              |
| Human     | Provider     | Team security through provider identity and permissions |

The 0.2 rule policy contains only `agent | human` authority.

The core acceptance schema can reserve optional proof metadata.

Do not add a required verification policy until a provider adapter exists.

## Text and UI selection

Text is the default review surface for a small finding queue.

The integration can suggest the UI for a large or complex queue.

The human can request the UI at any time.

The integration must not open a browser without a user action or a documented local preference.

A future preference can use `never`, `ask`, or `auto` UI modes.

The project must not add this setting before it tests the default workflow.

## Shared review outcome

All review surfaces return one semantic outcome.

```ts
interface ReviewOutcome {
  readonly accepted: ReadonlyArray<AcceptanceInput>;
  readonly feedback: ReadonlyArray<ReviewFeedback>;
  readonly unresolved: ReadonlyArray<FindingId>;
}
```

This shape is conceptual.

The shared application handler validates and writes acceptances.

The UI, terminal, and future provider adapters must not implement different gate rules.

Copyable agent instructions cannot create a human acceptance by themselves.

## Active agent handoff

An adapter translates the review outcome to its agent harness.

When the harness supports continuation, feedback returns to the same active agent loop.

When the harness has a completion hook, unresolved findings deny completion with concise feedback.

When the harness supports neither function, the CLI exits with failure and the user reruns the agent.

The review server can wait for a local UI outcome and resume the waiting application handler.

The UI must not own session continuation logic.

## Checkpoint behavior

Use these default checkpoints:

### After an edit or explicit partial check

- Report applicable findings.
- Let the agent continue reversible coding work.
- Do not remove acceptances from unexamined files.
- Do not claim that the final gate passed.

### Before agent completion

- Run the complete applicable work check.
- Report every unresolved finding.
- Return agent-resolvable feedback to the active loop.
- Request human review for unresolved human findings.
- Deny silent completion.

### In CI

- Run the complete repository and change checks.
- Validate all active acceptances.
- Fail after any engine or configuration error.
- Fail for each unresolved finding.

## Human review queue

The completion check can group human findings into one review request.

Grouping reduces interruptions. It does not merge findings or fingerprints.

The human can accept some findings and return feedback for others.

The agent receives the feedback and continues work when the harness supports continuation.

A changed finding needs a new review under [ADR-005](./adr-005-fingerprints-and-lineage.md).

## Emergency operation

The core does not add a special break-glass finding state.

An authorized human can accept an urgent finding with a clear reason.

Repository administrators control emergency CI or branch bypasses outside agentlint.

A future provider adapter can require additional evidence for emergency use.

## Golden product demonstrations

### Existing repository adoption

1. Install a detector package or create a detector.
2. Bind the detector to the applicable paths.
3. Run a non-gating calibration scan.
4. Review matches in text or the UI.
5. Improve scope, guidance, and fixtures.
6. Enable the binding.
7. Fix or accept current findings.
8. Confirm the same result in CI.

### Destructive migration with human authority

1. An agent adds a destructive migration.
2. A change detector reports the operation.
3. The agent gathers evidence and continues related safe work.
4. The completion checkpoint requests human review.
5. The human requests a safer rollout sequence.
6. The agent changes the migration.
7. The old finding and acceptance cannot open the new gate.
8. The final check passes after the finding disappears or receives acceptance.

### Recurring review feedback

1. A reviewer identifies repeated judgment feedback.
2. The rule advisor separates the standard, detector, and binding.
3. The agent creates fixtures and scans the repository.
4. The repository reviews and enables the binding.
5. A later agent change triggers the standard at the applicable checkpoint.

## Rejected alternatives

### Provider-only human acceptance

This model gives stronger identity.

It slows local work and excludes individual developers.

### Local acceptance as identity proof

An unrestricted local agent can change repository files.

The product must not claim a security guarantee that it cannot enforce.

### UI-only review

This model makes browser interaction necessary for routine use.

Small finding queues work better in the active text loop.

### Permanent non-blocking rules

This model lets enabled findings pass without a result.

Deferred interaction provides workflow speed without weakening the final gate.

### Durable calibration database

This model creates candidate lifecycle state and cleanup work.

The final detector, binding, fixtures, and Git history preserve useful calibration results.

## 0.2 implementation

The CLI does not use an automatic finding-count threshold. A person or coding agent can open the UI when the text loop is not sufficient.

The `approve` command records one human acceptance. The `review` command opens the local workspace.

Version 0.2 does not resume a harness through a provider protocol. The final screen gives copyable agent instructions.

Calibration feedback stays in the browser session. A reviewer can copy or download it.

The detached artifact uses the version 1 review state contract. Detached acceptance output uses the exact acceptance-record JSONL contract.

The FoldKit local UI ships in the package.

Only `check --all` without file or rule filters is a complete view. A monorepo partial job cannot remove unexamined acceptances.

The demo verifies a state detector, a change detector, local human acceptance, detached review, and equal local and CI gate semantics.

Provider proof metadata remains a later adapter concern.

## Consequences

The UI has a defined optional role in both authoring and acceptance.

Local acceptance remains fast and useful for individual developers.

Provider verification can strengthen team workflows without changing the core engine.

The integration layer must distinguish early feedback from final gate completion.

The 0.2 baseline needs both state and change detector workflows.

## Revision history

- 2026-08-10: The team proposed calibration, checkpoint review, and local acceptance as 0.2 workflows.
- 2026-08-10: The team accepted attached and detached review through one local SPA.
