# ADR-001: Rule lifecycles

- Status: Accepted
- Date: 2026-08-10
- Depends on: [PDR-001](./pdr-001-product-core.md)
- Related to: [ADR-004](./adr-004-rule-composition.md), [ADR-005](./adr-005-fingerprints-and-lineage.md)

## Decision

Each detector has one lifecycle. The lifecycle is `state` or `change`.

One standard can use multiple detectors. Detectors for one standard can have different lifecycles.

A repository binding enables each detector independently.

AST matching, path selection, diffs, and repository inspection are detection capabilities. They are not lifecycles.

## Context

The first agentlint engine found AST nodes in current source files.

Some recurring review concerns depend on a before-and-after relationship. The project needs a model that supports both concerns without one general event system.

The model must also define the lifetime of a finding and its acceptance.

## State lifecycle

A state rule asks: Does this judgment condition exist in the current repository?

Examples: an unbounded query exists, a dangerous API call exists, an authentication route lacks required handling.

A state detector declares `match` patterns or a `createOnce` visitor. It receives the current source file. The finding stays applicable while the normalized evidence stays in the repository.

`agentlint check` runs state rules on changed files. `agentlint check --all` runs them on the complete repository.

## Change lifecycle

A change rule asks: Did this change make a judgment condition?

Examples: a public export was removed, a dependency was added, a migration added a destructive operation.

A change detector implements `detect(context, options)`. The context contains a normalized `ChangeSet`. The set has the selected Git baseline, one entry for each changed file with its status, previous path, before and after snapshots, and hunks.

The engine compares the merge base of the selected ref with the complete working tree. `--base <ref>` or the config `base` selects the ref. Otherwise the engine detects an upstream or conventional main branch. The engine stops with an error when it cannot resolve a base.

`agentlint check` runs every enabled change rule on each run. The final repository state might not contain sufficient evidence to make the finding again. Git keeps the acceptance after the change merges.

## Detection capabilities

A binding selects files with `include` and `exclude` globs. A config can add repository-wide `ignores`.

A state detector matches syntax with a pattern or a tree-sitter query. `createOnce` is the imperative escape hatch. The engine calls `createOnce` one time for each rule before it visits files. The visitor examines every selected file. `before(filename)` runs for each file and can return `false` to skip it. `after()` runs one time at the end. The engine drains reported findings after `after()`.

A change detector inspects the change set directly. It can parse changed content with its own logic. Do not use `createOnce` for change rules.

Text search is not a separate capability. Use syntax matching when syntax gives better precision.

## One standard or two standards

Use one standard when multiple detectors ask the same review question. For example, one destructive migration standard can detect a dropped table, a dropped column, and irreversible raw SQL.

One standard can have a state detector for adoption scans and a change detector for precise change evidence.

Use two standards when the review questions or guidance differ. Do not give one detector two lifecycles.

## Public API

One `defineRule` function accepts both lifecycles. The `lifecycle` field discriminates the detector and fixture contracts. TypeScript overloads and a runtime validation reject invalid combinations.

```ts
defineRule({
  lifecycle: "change",
  standard: { id: "api/public-exports", revision: 1, title: "...", guidance: { standard: "..." } },
  detector: { id: "ts/public-export-removed", version: 1, detect(context) {} },
  binding: { id: "api/public-exports", authority: "agent" },
});
```

Every finding uses one `FindingRecord`. It contains the rule id, lifecycle, authority, source identity, fingerprint, optional lineage key, file, position, message, and source snippet. A change finding does not need an AST node.

## Fixtures and fingerprints

A detector can declare `mustReport` and `mustStaySilent` fixtures. A state fixture is a source string, a labeled source, or a small in-memory repository. A change fixture is a before and after repository pair or an exact change set. `agentlint rules test` runs them.

Fixtures are regression evidence. They do not prove that a detector finds all cases. A newly found missed case adds a fixture. The engine never sends fixture code to the agent as guidance.

A state fingerprint uses the `source-structure` scheme. It digests the normalized path, the node structure, the captures, and a detector-owned occurrence counter. Two equal conditions in one file get different fingerprints. Line numbers are not an input.

A change fingerprint uses the `git-change` scheme. It digests the detector `evidence`, the before and after paths, the file operation, and the detector `key`. [ADR-005](./adr-005-fingerprints-and-lineage.md) defines the schemes.

## Rejected alternatives

AST as the rule type: This model makes an implementation capability the product boundary. It cannot represent concerns that exist only in a change.

Source, file, change, project, session, and command scopes: This model mixes evidence location, lifecycle, and evaluation time. It creates overlapping terms and unclear acceptance lifetimes.

One general event rule: This model gives maximum flexibility but removes useful constraints. It makes fixtures, fingerprints, and integrations more difficult to define.

Lifecycle on the standard: This model prevents one review question from using state and change detectors. It couples durable policy to one detection strategy.

## Reconsideration conditions

The project reconsiders this model when a real concern needs a third acceptance lifetime.

The project reconsiders the change baseline when an integration needs a comparison that is not a Git merge base.

## Consequences

The finding domain does not require an AST node.

The engine separates rule lifecycle from evaluation time. An integration can run `check` at any time.

The test API supports source, repository, and before-and-after fixtures.

The fingerprint design supports state and change evidence with separate schemes.

## Revision history

- 2026-08-10: The team proposed the state and change lifecycle model.
- 2026-08-10: The team separated detector fixtures from positive agent guidance.
- 2026-08-10: The team separated durable standards from executable detectors.
- 2026-08-10: The team moved lifecycle from the standard to each detector.
- 2026-08-10: The team accepted one discriminated `defineRule` API.
- 2026-08-10: The team completed the state and change pipelines for 0.2.
- 2026-08-28: Condensed and aligned with the 0.2 implementation.
