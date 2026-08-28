# ADR-005: Fingerprints and acceptance lineage

- Status: Accepted
- Date: 2026-08-10
- Depends on: [ADR-002](./adr-002-acceptance-model.md)
- Related to: [ADR-004](./adr-004-rule-composition.md)

## Decision

An acceptance opens a gate only for one exact compatible finding fingerprint.

A material evidence change creates a new unresolved finding.

The engine can show a related prior acceptance as context. Prior context never opens the gate.

Fingerprint algorithms and acceptance record schemas use separate versions.

Complete checks remove stale acceptances. Partial checks never remove them.

## Goals

The model must meet these goals:

- Keep valid acceptances through nonmaterial formatting changes.
- Invalidate acceptances after material evidence changes.
- Preserve useful prior reasoning without preserving authority.
- Support algorithm improvements.
- Avoid a permanent lineage database.
- Keep current acceptance state small and understandable.

## Finding identity

A finding has a source identity and an evidence identity.

The source identity has these values:

```ts
interface FindingSource {
  readonly standardId: string;
  readonly standardRevision: number;
  readonly detectorId: string;
  readonly detectorVersion: number;
  readonly bindingId: string;
  readonly bindingDigest: string;
}
```

The evidence identity has these values:

```ts
interface Fingerprint {
  readonly scheme: string;
  readonly version: number;
  readonly digest: string;
}
```

The full acceptance key contains both identities.

The standard revision changes when the semantic decision contract changes.

The binding digest changes when material effective binding configuration changes.

The `scheme` identifies the evidence family, such as `source-ast` or `git-change`.

The `version` identifies the normalization algorithm for that scheme.

The digest is a hash of canonical evidence.

## Canonical evidence

Each detector produces typed evidence before the engine calculates a fingerprint.

The fingerprint implementation converts that evidence to one canonical representation.

The canonical representation must include all values that can change the review judgment.

The canonical representation must exclude presentation-only values.

Line and column numbers are presentation values unless position changes the policy meaning.

File paths are material by default.

A detector can declare a narrower path policy only with documented evidence semantics.

## State evidence

A state fingerprint normally includes these values:

- The source identity.
- The normalized repository-relative path.
- The normalized matched structure.
- Material captured values.
- A stable occurrence discriminator.

Formatting and line movement do not invalidate the acceptance when normalized structure stays equal.

A file move invalidates the acceptance by default.

A material captured value change invalidates the acceptance.

Two equal occurrences in one file need different fingerprints.

The occurrence discriminator must not use only line numbers.

The implementation must test repeated equal structures before it accepts this ADR.

## Change evidence

A change fingerprint normally includes these values:

- The source identity.
- The normalized before evidence.
- The normalized after evidence.
- Material paths.
- The change operation type.
- A stable occurrence discriminator.

The fingerprint must not use commit identifiers as the main evidence identity.

An equal normalized change can keep its fingerprint after a rebase.

A changed base invalidates the acceptance when it changes the material comparison.

Rename and move operations are material by default.

## Acceptance record

The conceptual record becomes:

```ts
interface AcceptanceRecord {
  readonly schemaVersion: 1;
  readonly source: FindingSource;
  readonly fingerprint: Fingerprint;
  readonly reason: string;
  readonly authority: "agent" | "human";
  readonly actor?: string;
  readonly acceptedAt: string;
}
```

The record schema version controls decoding and storage migration.

The fingerprint version controls evidence comparison.

The implementation must not use one version field for both concerns.

## Exact compatibility rule

An acceptance opens a gate only when all these values match:

- Standard identifier.
- Standard revision.
- Detector identifier.
- Detector version.
- Binding identifier.
- Binding digest.
- Fingerprint scheme.
- Fingerprint version.
- Fingerprint digest.
- Sufficient acceptance authority.

Any mismatch keeps the finding unresolved.

An editorial standard change does not change the standard revision.

A semantic criteria change must change the standard revision.

A material binding configuration change must change the binding digest.

An authority change uses the separate sufficient-authority check.

## Lineage context

Lineage helps the agent or human understand a related prior decision.

Lineage does not transfer acceptance.

The engine can find lineage through a detector-provided `lineageKey`.

The key must be stable enough to find a related judgment point.

The key must not be part of gate validation.

A lineage result can show these values:

- The prior reason.
- The prior authority path.
- The changed evidence summary.
- A clear stale label.

The UI and CLI must not display lineage as an active acceptance.

An agent can use lineage to make a new judgment for an agent-authority finding.

A human-authority finding always needs a new human acceptance after invalidation.

## Stale record cleanup

A stale acceptance has no equal finding in a complete applicable check.

A complete check can remove the stale record.

A partial file check cannot prove that a record is stale.

A partial check must not remove acceptance records.

When a new acceptance replaces related stale evidence, the writer removes the old record.

Git preserves the prior reason after current-state cleanup.

The core does not keep a lineage archive or event ledger.

## Cleanup truth table

| Check view | Equal finding | Related changed finding | Action                                           |
| ---------- | ------------- | ----------------------- | ------------------------------------------------ |
| Partial    | Yes           | No                      | Keep active acceptance                           |
| Partial    | No            | Unknown                 | Keep record without gate effect                  |
| Complete   | Yes           | No                      | Keep active acceptance                           |
| Complete   | No            | Yes                     | Remove stale record after replacement or cleanup |
| Complete   | No            | No                      | Remove stale record                              |

## Version changes

The reader must decode all supported acceptance schema versions.

A storage migration can rewrite a record only when it preserves its exact meaning.

A fingerprint algorithm upgrade must not silently equate old and new digests.

The engine can migrate a fingerprint only when it can prove canonical evidence equivalence.

Otherwise, the old acceptance becomes stale context and the new finding stays unresolved.

The release notes must identify fingerprint changes that invalidate acceptances.

## Detector changes

A detector version changes when normalized evidence semantics change.

Examples include new material captures, changed path meaning, or changed evidence boundaries.

A detector version need not change for an internal performance improvement with equal evidence output.

The detector package must document version changes.

## Standard changes

The standard revision changes when judgment criteria or permitted outcomes change.

The standard revision does not change for spelling, formatting, or clearer equivalent wording.

A revision change invalidates existing acceptances for that standard.

The engine can show the prior acceptance reason as lineage context.

## Binding changes

The engine calculates a binding digest from canonical material configuration.

Material configuration includes detector options, included scope, and excluded scope.

Equivalent ordering and syntax must produce the same digest.

A digest change invalidates existing acceptances for that binding.

An authority policy does not enter the binding digest.

The engine validates stored authority against the current authority policy independently.

An `agent` acceptance becomes insufficient when the binding changes to `human` authority.

A prior `human` acceptance can satisfy a later `agent` authority when all identity values remain equal.

## Failure behavior

Unknown fingerprint schemes keep findings unresolved.

Unsupported fingerprint versions keep findings unresolved.

Malformed acceptance records cause a clear configuration error.

The engine must not open a gate after a fingerprint error.

## Required documentation

The implementation documentation must contain these items:

- A finding state diagram.
- The exact acceptance compatibility table.
- Canonical evidence rules for each scheme.
- Partial and complete cleanup behavior.
- Duplicate occurrence behavior.
- Rename and move behavior.
- Rebase behavior for change findings.
- Schema and fingerprint version migration behavior.
- Detector version responsibilities.
- Standard revision responsibilities.
- Binding digest canonicalization.
- Security and identity non-guarantees.

## Rejected alternatives

### Keep acceptance after any related change

This model reduces repeated review.

It can preserve approval after the evidence that justified it changes.

### Always invalidate on text change

This model is safe but noisy.

Formatting and line movement would create unnecessary repeated judgment.

### One version number

Storage format and fingerprint semantics change for different reasons.

One version number hides the migration boundary.

### Permanent lineage records

This model recreates an event ledger.

Git already preserves old acceptance records.

### Delete stale records after every check

A partial check cannot know whether an unexamined finding still exists.

This model can delete a valid acceptance.

## 0.2 implementation

The `source-structure` scheme has version 1. It hashes the repository path, semantic syntax structure, and an equal-structure occurrence number.

The `git-change` scheme has version 1. It hashes normalized detector evidence, material paths, the Git operation, and a detector-owned occurrence key.

The binding digest contains `include`, `exclude`, and detector options. Set-like path lists have a stable order. The authority policy uses the separate authority compatibility rule.

A semantic standard change requires a new standard revision. A detector evidence change requires a new detector version.

Version 0.2 does not infer equivalence between fingerprint versions. An unknown scheme or version cannot open the gate.

A complete check removes an acceptance when no equal current finding exists. A partial check does not count or remove unexamined records.

The tests cover canonical encoding, formatting and line movement, file movement, duplicate occurrences, rebases, component version changes, authority changes, lineage context, and complete cleanup.

## Questions for a later version

- Can the engine prove equivalence for a specific future fingerprint upgrade?
- Does JSONL remain the best current-state storage format at large scale?
- Does a future provider need signed human authority?

## Consequences

Acceptance reuse stays conservative.

Prior reasoning can reduce repeated work without keeping dead authority alive.

Detector authors must define evidence semantics as part of their public contract.

The implementation needs explicit complete and partial check modes.

Fingerprint changes become documented compatibility events.

## Revision history

- 2026-08-10: The team proposed versioned fingerprints, non-authoritative lineage, and complete-view cleanup.
- 2026-08-10: The team added standard revisions, binding digests, and independent authority validation.
- 2026-08-10: The team accepted the record after the 0.2 implementation and compatibility tests.
