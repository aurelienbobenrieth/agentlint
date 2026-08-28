# ADR-002: Acceptance model

- Status: Accepted
- Date: 2026-08-10
- Depends on: [PDR-001](./pdr-001-product-core.md)
- Related to: [ADR-004](./adr-004-rule-composition.md)

## Decision

A finding is unresolved or accepted.

The project stores current acceptances. It does not store an append-only event ledger.

Each repository binding has an `agent` or `human` authority policy.

The project uses `acceptance` as the primary domain term for a stored result.

## Context

The first 0.2 design has these disposition values:

- `accepted`
- `deferred`
- `no_fix`
- `approval_requested`
- `approved`

The design also has `ephemeral` and `durable` persistence values.

Most values do not make different gate behavior clear.

The append-only ledger grows with all result events. Each check reads the full file.

Git already keeps old versions of committed project files.

## Finding state

The engine derives finding state with these rules:

```text
The finding does not exist.
Result: The code or change removed the condition.
Stored acceptance: None is necessary.

The finding exists and has no valid acceptance.
Result: Unresolved.
Gate: Closed.

The finding exists and has a valid acceptance.
Result: Accepted.
Gate: Open for this finding.
```

The engine must not add a stored state unless that state changes gate behavior.

## Acceptance meaning

An acceptance states that the matched evidence is permitted for a documented reason.

An acceptance does not always mean that the code violates a standard.

Some rules identify a decision point. The acceptance can state that the evidence satisfies the standard.

An acceptance contains the authority that made the result.

## Authority policy

Each repository binding has one authority policy:

```ts
type Authority = "agent" | "human";
```

For `agent` authority:

- An agent can create an acceptance.
- A human can create an acceptance.
- A reason is necessary.

For `human` authority:

- Agent-facing interfaces cannot create an acceptance.
- The agent can ask a human for approval.
- The finding stays unresolved until a human workflow creates an acceptance.
- A reason is necessary.

Use `authority`, not `resolution`, in rule policy.

The word `authority` states who can accept. The word does not describe the current finding state.

## Human workflow guarantee

The engine guarantees this behavior in the normal workflow:

> The gate stays closed until a valid acceptance has the authority that the rule requires.

The supported agent workflow must not complete silently while a human finding stays unresolved.

The agent must fix the evidence or ask a human for judgment.

The product must keep human acceptance out of agent-specific interfaces.

For example, MCP tools and automatic hooks must not create a human acceptance.

A human workflow can use an interactive CLI, a local UI, or a provider review.

The 0.2 release decision will select the required human workflow.

## Security boundary

A local human gate is a workflow boundary. It is not an adversarial security boundary.

An agent with unrestricted file access can change the acceptance file, the config, or the package code.

The acceptance file gives visible evidence in the Git change. It does not prove a human identity.

These external controls can give a stronger security boundary:

- Protected branches.
- Required reviews.
- CODEOWNERS.
- Provider identities.
- Signed checks.
- Protected environments.

The documentation must not describe an actor string as identity proof.

## Stored state

Use this path for current acceptances:

```text
.agentlint/acceptances.jsonl
```

The file contains one current record for each finding source and fingerprint.

The writer must sort the records in a deterministic order.

The writer replaces the record when the acceptance data changes.

The writer must not append a second lifetime event for the same active finding.

Git keeps previous file versions.

## Conceptual record

The minimum record has this shape:

```ts
interface AcceptanceRecord {
  readonly version: 1;
  readonly standardId: string;
  readonly standardRevision: number;
  readonly detectorId: string;
  readonly detectorVersion: number;
  readonly bindingId: string;
  readonly bindingDigest: string;
  readonly fingerprint: string;
  readonly reason: string;
  readonly authority: "agent" | "human";
  readonly actor?: string;
  readonly acceptedAt: string;
}
```

This shape is conceptual. [ADR-005](./adr-005-fingerprints-and-lineage.md) proposes the versioned implementation shape.

The `authority` field records the authority path. It does not prove identity.

The `actor` field is audit information. The engine must not use free actor text as security proof.

## Approval request

An approval request does not open the gate.

The request gives the finding, the agent reason, and applicable evidence to a human.

The core acceptance file contains only accepted findings.

The 0.2 implementation must select one request transport:

- Current terminal or agent session output.
- A local review session.
- A provider review comment.
- A small current request file.

Do not add a request file until an asynchronous workflow requires durable request state.

If a later acceptance retains request data, put the request data in an optional nested field.

Do not make request history append-only.

## Stale acceptances

An acceptance is stale when no current finding has the same source identity and fingerprint.

Normal checks must ignore stale acceptances.

The writer can remove stale acceptances automatically when it has a complete applicable repository view.

The writer must not remove an acceptance after a partial file check.

CI can report stale acceptances as maintenance information.

Stale acceptance cleanup must not block the main agent loop unless the team makes a later decision.

## Acceptance invalidation

The engine invalidates an acceptance when material evidence changes.

The fingerprint must not depend mainly on line or column numbers.

A line move must not invalidate an acceptance when the evidence is equal.

A material code or change update must invalidate the acceptance.

The standard, detector, and binding identities remain part of the acceptance key.

The rule fingerprint contract needs a separate implementation decision before non-source findings ship.

## CLI language

Use direct acceptance language.

The preferred agent-authority command is:

```text
agentlint accept <selector> --reason "..."
```

The human-authority command can remain different when that difference makes the workflow clear:

```text
agentlint approve <selector> --reason "..."
```

Both commands create an acceptance. `approve` identifies the human workflow entry point.

Use this command group for stored records:

```text
agentlint acceptances list
agentlint acceptances review --base <ref>
agentlint acceptances clean
```

The exact command names need CLI review before implementation.

## CI behavior

CI runs the applicable rules with a complete change or repository view.

CI closes the gate when one or more findings have no valid acceptance.

CI validates that each acceptance authority satisfies the rule policy.

CI does not treat an approval request as an acceptance.

CI does not treat a text actor value as verified identity.

A provider integration can add verified identity in a later version.

## Removed values

### `no_fix`

This value has the same gate result as acceptance.

The reason can state that a fix is not applicable.

### `deferred`

A deferred finding is not accepted.

It stays unresolved and keeps the gate closed.

The developer can keep future work in an issue or another planning system.

### `approved`

This value duplicates acceptance state.

The acceptance authority records whether a human approved the finding.

### `approval_requested`

This value is a workflow request, not a gate result.

It must not appear as an accepted state.

### `ephemeral` and `durable`

These values do not have defined retention behavior.

Remove both values.

Add a new policy only when it changes engine behavior.

## No migration

The project will not migrate the unreleased 0.2 ledger model.

The implementation will remove the development ledger files and use the new acceptance model.

The released 0.1 migration requirements need a separate check before the 0.2 release.

## Rejected alternatives

### Append-only ledger

This model stores duplicate lifetime events in the current repository file.

It makes read cost and file size depend on project history.

### Decision file

This term is correct but broad. The current file stores only accepted findings.

### Resolution file

This term includes code fixes, but code fixes do not need stored records.

### Exception or waiver file

These terms imply a violation. Some accepted findings satisfy the rule standard.

### Authenticated local actor

This model cannot give a reliable security guarantee when the agent has unrestricted repository access.

## 0.2 implementation

Version 0.2 ships the `approve` command and the local review SPA for human acceptance.

The product does not store approval requests. Requested changes are review-session feedback for the coding agent.

An acceptance record contains the schema version, source identity, fingerprint, optional lineage key, reason, authority, actor, and acceptance time.

The source identity contains the standard revision and detector version.

The engine recomputes findings on the current branch. An acceptance opens the gate only when its identity is equal to a current finding.

A complete check removes stale records. The `acceptances clean` command runs this complete comparison.

Version 0.2 uses sorted current-state JSONL. Git supplies record history.

A future provider can add verified human authority through an adapter. The adapter must preserve the same authority rule.

## Consequences

The engine and UI can remove multiple disposition branches.

The config can remove persistence policy.

The review model can show one accepted result with its authority.

The Git diff stays proportional to active acceptances.

The review artifact and SPA show current acceptance comparison.

## Revision history

- 2026-08-10: The project accepted the binary finding and acceptance model.
- 2026-08-10: The project clarified the human interruption guarantee.
- 2026-08-10: The project aligned acceptance identity with standard, detector, and binding composition.
- 2026-08-10: The project added semantic standard and material binding identity to acceptance compatibility.
