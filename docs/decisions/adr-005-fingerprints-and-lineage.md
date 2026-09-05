# ADR-005: Fingerprints and acceptance lineage

- Status: Accepted
- Date: 2026-08-10
- Depends on: [ADR-002](./adr-002-acceptance-model.md)
- Related to: [ADR-004](./adr-004-rule-composition.md)

## Decision

An acceptance opens a gate only for one exact compatible finding identity.

A material evidence change creates a new unresolved finding.

The engine can show a related prior acceptance as lineage context. Lineage never opens the gate.

Fingerprint algorithms and acceptance record schemas use separate versions.

Complete checks remove stale acceptances. Partial checks never remove them.

## Context

The model must keep valid acceptances through formatting changes, invalidate them after material evidence changes, preserve useful prior reasoning without preserving authority, and keep the current acceptance state small without a permanent lineage database.

## Finding identity

A finding has a source identity and an evidence identity.

The `FindingSource` contains `standardId`, `standardRevision`, `detectorId`, `detectorVersion`, `bindingId`, and `bindingDigest`. [ADR-004](./adr-004-rule-composition.md) defines these values.

The `Fingerprint` contains a `scheme`, a `version`, and a `digest`.

The scheme identifies the evidence family. The version identifies the normalization algorithm for that scheme. The digest is a SHA-256 hash of canonical JSON evidence with sorted object keys and exact Unicode strings.

The acceptance key contains the complete source identity and the complete fingerprint.

## State evidence

The `source-structure` scheme has version 2. It hashes these values:

- The normalized repository-relative path.
- The semantic structure of the containing file. The structure contains node types and leaf text. It excludes positions.
- An occurrence key. The key contains a structural child path or a unique detector-owned key.

Formatting and line movement do not change the fingerprint when the node structure stays equal. A file move or a change to the containing file structure invalidates the acceptance. Explicit binding dependency contents and optional reported evidence also enter the fingerprint.

Two equal occurrences in one file get different fingerprints. Structural paths follow document order. The file structure also changes when an occurrence disappears. An acceptance cannot transfer to an equal sibling.

## Change evidence

The `git-change` scheme has version 2. It hashes these values:

- The detector-selected `evidence` value.
- The normalized before path and after path.
- The Git operation: `add`, `delete`, `modify`, or `rename`.
- The detector-owned occurrence `key`.

The fingerprint does not use commit identifiers. An equal normalized change keeps its fingerprint after a rebase. A changed base invalidates the acceptance when it changes the material comparison. A rename or move is material.

A change detector owns its evidence semantics. It must keep `key` stable across line movement.

## Acceptance record and compatibility

An `AcceptanceRecord` contains `schemaVersion`, `source`, `fingerprint`, an optional `lineageKey`, `reason`, `authority`, an optional `actor`, and `acceptedAt`.

The record schema version controls decoding. The fingerprint version controls evidence comparison. The implementation does not use one version field for both concerns.

An acceptance opens a gate only when all these conditions are true:

- The engine supports both fingerprint schemes and versions.
- Every `FindingSource` field is equal.
- The fingerprint scheme, version, and digest are equal.
- The acceptance authority satisfies the finding authority.

Any mismatch keeps the finding unresolved.

A `human` acceptance satisfies `agent` and `human` policy. An `agent` acceptance satisfies only `agent` policy. A binding change from `agent` to `human` authority makes existing agent acceptances insufficient.

An unknown scheme or version keeps the finding unresolved. A malformed or duplicate acceptance record causes a configuration error. The engine never opens a gate after a fingerprint error. Version 0.2 decodes schema version 1 only and does not infer equivalence between fingerprint versions.

## Lineage context

Lineage helps an agent or a human understand a related prior decision. Lineage does not transfer acceptance.

Every finding has a `lineageKey`. A state finding derives it from the binding identifier, the path, and the occurrence key. A change detector can supply its own key. Otherwise the engine derives it from the binding identifier, the path, and the occurrence key.

The engine finds lineage when a stored record has the same lineage key, standard identifier, detector identifier, and binding identifier, and the record does not satisfy the finding. It returns the most recent related record.

The check output, the `explain` command, and the review SPA show the prior reason, authority, and date. They label it as context only.

An agent can use lineage to make a new judgment for an agent-authority finding. A human-authority finding needs a new human acceptance after invalidation.

## Stale record cleanup

A stale acceptance has no equal finding in a complete check.

A complete check removes stale records. A partial check cannot prove that a record is stale and never removes one.

A writer replaces only the same exact acceptance identity. Related lineage never removes another record during a partial update; a complete check proves which identities are stale.

`acceptances import` validates each record against a complete check and rejects records that no longer match.

Git preserves prior reasons after cleanup. The core does not keep a lineage archive or event ledger.

## Rejected alternatives

### Keep acceptance after any related change

This model reduces repeated review. It can preserve approval after the evidence that justified it changes.

### Always invalidate on text change

This model is safe but noisy. Formatting and line movement would create unnecessary repeated judgment.

### One version number

Storage format and fingerprint semantics change for different reasons. One version number hides the migration boundary.

### Permanent lineage records

This model recreates an event ledger. Git already preserves old acceptance records.

### Delete stale records after every check

A partial check cannot know whether an unexamined finding still exists. This model can delete a valid acceptance.

## Reconsideration conditions

Reconsider this model when one condition occurs:

- The engine can prove canonical evidence equivalence for a specific fingerprint upgrade.
- JSONL current-state storage becomes too large or too slow.
- A provider needs signed human authority.

## Consequences

Acceptance reuse stays conservative.

Prior reasoning reduces repeated work without keeping dead authority alive.

Detector authors define evidence semantics as part of their public contract.

A fingerprint change is a documented compatibility event in the release notes.

## Revision history

- 2026-08-10: The team proposed versioned fingerprints, non-authoritative lineage, and complete-view cleanup.
- 2026-08-10: The team added standard revisions, binding digests, and independent authority validation.
- 2026-08-10: The team accepted the record after the 0.2 implementation and compatibility tests.
- 2026-08-28: Condensed and aligned with the 0.2 implementation.

- 2026-09-05: Version 2 preserves Unicode distinctions and includes containing-file structure and declared dependencies. Regression probes showed that node-only evidence retained decisions after guard removal. Structural occurrence identity fixes lineage collisions. Partial updates preserve other exact identities even when lineage matches. Version 1 fingerprints remain readable but require new review.
