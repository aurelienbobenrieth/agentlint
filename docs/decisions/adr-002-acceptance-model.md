# ADR-002: Acceptance model

- Status: Accepted
- Date: 2026-08-10
- Depends on: [PDR-001](./pdr-001-product-core.md)
- Related to: [ADR-004](./adr-004-rule-composition.md), [ADR-005](./adr-005-fingerprints-and-lineage.md), [ADR-006](./adr-006-review-workflows.md)

## Decision

A finding is `unresolved` or `accepted`. The engine derives this state. It does not store it.

The project stores current acceptances in `.agentlint/acceptances.jsonl`. It does not store an append-only event ledger.

Each repository binding has an `agent` or `human` authority policy.

The project uses `acceptance` as the domain term for a stored result.

## Context

The first 0.2 design had five disposition values and two persistence values. Most values did not change gate behavior.

The append-only ledger grew with all result events. Each check read the full file.

Git already keeps old versions of committed project files.

## Finding state and acceptance meaning

When the condition no longer exists, the engine reports nothing. No stored record is necessary.

When the finding exists without a compatible acceptance, the finding is unresolved. The gate is closed. `check` exits with code `1`.

When the finding exists with a compatible acceptance, the finding is accepted. The gate is open for this finding.

An acceptance states that the matched evidence is permitted for a documented reason. It does not always mean that the code violates the standard. Some rules identify a decision point, and the acceptance can state that the evidence satisfies the standard.

The engine does not add a stored state unless that state changes gate behavior.

## Authority policy

Each binding declares `authority: "agent" | "human"`.

A human acceptance satisfies both policies. An agent acceptance satisfies only an `agent` policy.

`agentlint accept` creates an agent acceptance. When the binding requires human authority, `accept` refuses with exit code `2` and points to `agentlint approve` or `agentlint review`.

`agentlint approve` and the review SPA create a human acceptance. Both paths need a reason. The word `authority` states who can accept. It does not describe the current finding state.

An agent can record a proposal with `agentlint propose`. The engine stores one proposal for each exact finding identity in `.agentlint/proposals.jsonl`. A proposal gives a human the agent summary and diff. It never opens the gate.

## Security boundary

A local human gate is a workflow boundary. It is not an adversarial security boundary.

A process with repository write access can run `approve`, edit the acceptance file, or edit the config. The Git change makes these edits visible.

The `actor` field is audit information. The CLI fills it from `AGENTLINT_ACTOR`, from a detected agent environment, or from the local username. The engine never uses it as identity proof.

Protected branches, required reviews, CODEOWNERS, and provider identities give a stronger boundary. A provider adapter can add verified authority later without a change to the gate rule.

## Stored record

The file contains one sorted JSONL record for each exact finding identity. The store rejects a duplicate identity and an invalid record.

```ts
interface AcceptanceRecord {
  schemaVersion: 1;
  source: { standardId; standardRevision; detectorId; detectorVersion; bindingId; bindingDigest };
  fingerprint: { scheme; version; digest };
  lineageKey?: string;
  reason: string;
  authority: "agent" | "human";
  actor?: string;
  acceptedAt: string;
}
```

An acceptance opens the gate only when every source field, the full fingerprint, and the authority are compatible with a current finding. The engine also rejects a fingerprint scheme or version that it does not support. [ADR-005](./adr-005-fingerprints-and-lineage.md) defines fingerprints and lineage.

A new acceptance must identify a finding in the current check view. The writer replaces an older record only with the same exact identity. Lineage is context and never removes a different identity during a partial update. Git keeps previous file versions.

## Invalidation and stale records

A material code or change update produces a new fingerprint. The old acceptance no longer matches. A line move or a formatting-only edit keeps the same state fingerprint. A change to the standard revision, detector version, or material binding config also invalidates the acceptance.

When an unresolved finding shares a lineage key with an old record, `check` shows the prior reason. Lineage never opens the gate.

An acceptance is stale when no current finding has the same identity. A complete check (`check --all` without file or rule filters) removes stale records and reports the count. A partial check never removes records. `agentlint acceptances clean` runs the complete comparison on demand.

## CLI and CI

```text
agentlint accept <selector> --reason "..." [--base ref]
agentlint approve <selector> --reason "..." [--base ref]
agentlint propose <selector> --summary "..." [--diff-file path]
agentlint acceptances list | clean | import <decisions.jsonl>
```

CI runs the same binary gate as local development. It exits with `1` when one or more findings have no compatible acceptance. There is no CI-only severity.

`check --review-output` writes a detached review artifact. A human reviews it locally and exports acceptance JSONL. `acceptances import` re-runs the detectors and rejects the complete import when any decision no longer matches a current finding with compatible authority.

## Rejected alternatives

Append-only ledger: This model stores duplicate lifetime events in the repository file. Read cost and file size depend on project history.

`no_fix` value: This value has the same gate result as acceptance. The reason can state that a fix is not applicable.

`deferred` value: A deferred finding is not accepted. It stays unresolved. Future work belongs in an issue tracker.

`approved` value: This value duplicates acceptance state. The `authority` field records that a human accepted the finding.

`approval_requested` value: This value is a workflow request, not a gate result. The proposal store now holds this context outside the acceptance file.

`ephemeral` and `durable` persistence: These values had no defined retention behavior.

Decision file: This term is correct but broad. The file stores only accepted findings.

Resolution file: This term includes code fixes. Code fixes do not need stored records.

Exception or waiver file: These terms imply a violation. Some accepted findings satisfy the standard.

Authenticated local actor: This model cannot give a reliable guarantee when the agent has unrestricted repository access.

## Reconsideration conditions

The project reconsiders a new stored state when a real workflow needs different gate behavior.

The project reconsiders stale cleanup in `check` when automatic removal surprises users in CI.

The project reconsiders provider-verified authority when a team needs identity proof that local review cannot give.

## Consequences

The engine and the UI have one accepted result with its authority. There are no disposition branches.

The config has no persistence policy.

The Git diff stays proportional to active acceptances.

The review artifact and the SPA show current findings against current acceptances.

## Revision history

- 2026-08-10: The project accepted the binary finding and acceptance model.
- 2026-08-10: The project clarified the human interruption guarantee.
- 2026-08-10: The project aligned acceptance identity with standard, detector, and binding composition.
- 2026-08-10: The project added semantic standard and material binding identity to acceptance compatibility.
- 2026-08-28: Condensed and aligned with the 0.2 implementation.

- 2026-09-05: Requesting changes revokes an existing acceptance. Detached imports can carry conditional revocations of the reviewed decision. Revocations are operations, not another stored outcome. Exclusive transactions and atomic replacement protect concurrent decisions.
