# Decision records

**PDR = product: what agentlint is, for whom, and its scope. ADR = architecture: a technical model or an implementation constraint.**

## Records

| Record                                               | Status   | Subject                          | Outcome in one line                                                                                                                                      |
| ---------------------------------------------------- | -------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PDR-001](./pdr-001-product-core.md)                 | Accepted | Product purpose and scope        | Turn recurring human review judgment into deterministic, repository-owned gates for coding agents. No AI model in the engine.                            |
| [ADR-001](./adr-001-rule-lifecycles.md)              | Accepted | State rules and change rules     | Each detector is `state` or `change`. One standard can mix both; the binding enables each detector on its own.                                           |
| [ADR-002](./adr-002-acceptance-model.md)             | Accepted | Findings, acceptances, authority | A finding is `unresolved` or `accepted`, derived, never stored. Only current acceptances are stored. Each binding requires `agent` or `human` authority. |
| [ADR-003](./adr-003-application-and-integrations.md) | Accepted | Application API and adapters     | The CLI and the review SPA call the same handlers. No MCP server or harness adapter; the action and hook wrap the CLI.                                   |
| [ADR-004](./adr-004-rule-composition.md)             | Accepted | Standards, detectors, bindings   | A rule is a standard, a detector, and a repository binding, kept in separate fields of one `defineRule`.                                                 |
| [ADR-005](./adr-005-fingerprints-and-lineage.md)     | Accepted | Finding identity and lineage     | Acceptance matches one exact source + fingerprint. Lineage is context only. Only a complete check removes stale records.                                 |
| [ADR-006](./adr-006-review-workflows.md)             | Accepted | Calibration and review           | Calibrate before enforcing, review after. CLI or one local SPA, attached or detached. Local human acceptance is not identity proof.                      |
| [ADR-007](./adr-007-foldkit-review-spa.md)           | Accepted | FoldKit review SPA               | The review app is a FoldKit SPA on one Effect Schema contract shared with the server.                                                                    |
| [ADR-008](./adr-008-github-action.md)                | Accepted | GitHub action and PR review      | A thin action runs `check`, publishes a check run and comments, and records `/agentlint approve` from the PR.                                            |

## Status values

| Status       | Meaning                                  |
| ------------ | ---------------------------------------- |
| `Exploring`  | Collecting information and alternatives. |
| `Proposed`   | A candidate decision under review.       |
| `Accepted`   | The current project decision.            |
| `Superseded` | A later record replaces it.              |
| `Rejected`   | The team did not accept it.              |

## Writing a record

Decision in one bold line → context as a diagram or ≤3 bullets → consequences table (gain / cost) → rejected options table (option / why not) → reconsideration conditions → revision history.

Short sentences, active voice, one idea per block. Prefer a table or diagram over prose. Keep exact identifiers, versions, and negations.

## Changing a record

- Never silently change an accepted decision.
- Add the reason and the date to the revision history.
- Create a new record when a change replaces a fundamental decision.
- Keep rejected alternatives and reconsideration conditions in the original record.
