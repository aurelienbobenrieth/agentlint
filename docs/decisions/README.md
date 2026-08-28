# Decision records

This directory contains product decision records and architecture decision records.

A product decision record defines the product, its users, and its scope.

An architecture decision record defines a technical model or an implementation constraint.

## Status values

- `Exploring`: The team collects information and alternatives.
- `Proposed`: The record gives a candidate decision for review.
- `Accepted`: The record is the current project decision.
- `Superseded`: A later record replaces the decision.
- `Rejected`: The team does not accept the proposed decision.

## Records

| Record                                               | Status   | Subject                                  |
| ---------------------------------------------------- | -------- | ---------------------------------------- |
| [PDR-001](./pdr-001-product-core.md)                 | Accepted | Product purpose and scope                |
| [ADR-001](./adr-001-rule-lifecycles.md)              | Accepted | State rules and change rules             |
| [ADR-002](./adr-002-acceptance-model.md)             | Accepted | Findings, acceptances, and authority     |
| [ADR-003](./adr-003-application-and-integrations.md) | Accepted | Application API and integration adapters |
| [ADR-004](./adr-004-rule-composition.md)             | Accepted | Standards, detectors, and bindings       |
| [ADR-005](./adr-005-fingerprints-and-lineage.md)     | Accepted | Finding identity and acceptance lineage  |
| [ADR-006](./adr-006-review-workflows.md)             | Accepted | Calibration and acceptance review        |
| [ADR-007](./adr-007-foldkit-review-spa.md)           | Accepted | FoldKit review SPA                       |

## Writing rules

Use ASD-STE100 Simplified Technical English for these records.

Use project terms as technical nouns when the ASD-STE100 dictionary does not contain an equivalent word.

Write short sentences. Use active voice. Put one topic in each paragraph.

Do not use a semicolon.

## Change rules

Do not silently change an accepted decision.

Add the reason and the date to the revision history.

Create a new record when a change replaces a fundamental decision.

Keep rejected alternatives and reconsideration conditions in the original record.
