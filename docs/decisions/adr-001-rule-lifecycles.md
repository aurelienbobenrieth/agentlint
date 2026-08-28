# ADR-001: Rule lifecycles

- Status: Accepted
- Date: 2026-08-10
- Depends on: [PDR-001](./pdr-001-product-core.md)
- Related to: [ADR-004](./adr-004-rule-composition.md)

## Decision

Each detector has one lifecycle. The lifecycle is `state` or `change`.

A standard can use multiple detectors. Different detectors for one standard can have different lifecycles.

A repository binding enables each detector independently.

AST, text, paths, diffs, and repository inspection are detection capabilities. They are not rule lifecycles.

## Context

The first agentlint engine finds AST nodes in current source files.

Some recurring review concerns depend on a before-and-after relationship.

The project needs a model that supports both concerns without one general event system.

The model must also define the lifetime of a finding and its acceptance.

## Standard as a decision contract

One standard represents one review question.

The effective rule contains these parts:

- A stable standard identifier.
- One selected detector.
- One detector lifecycle.
- Guidance.
- One authority policy.
- Fixtures.
- A durable source reference when one is available.

All detectors for one standard must ask the same review question.

All detectors use the same standard guidance.

The repository binding owns the authority policy.

The stable standard identifier must not depend on the standard title or guidance text.

The durable source explains why the rule exists. The detector defines when the rule reports a finding.

## State lifecycle

A state rule asks this question:

> Does this judgment condition exist in the current repository state?

Examples include:

- An unbounded query exists.
- A dangerous API call exists.
- An authentication route does not have required handling.
- Two repository declarations are not consistent.

The state finding stays applicable while the evidence stays in the repository.

An acceptance stays valid while the normalized evidence stays unchanged.

A full repository check can find a state finding without a Git base reference.

## Change lifecycle

A change rule asks this question:

> Did this change make a judgment condition?

Examples include:

- A public export was removed.
- A dependency was added.
- Authentication requirements became less restrictive.
- A schema changed without a migration in the same change.
- A migration added a destructive operation.
- A package boundary changed without related consumer changes.

A change finding depends on a defined base and head state.

The finding is applicable to that change. The final repository state might not contain sufficient evidence to make the finding again.

Git keeps the historical acceptance after the change enters the base branch.

## Detection capabilities

A detector can use one or more capabilities.

### Path detection

Path detection selects files or repository areas.

Examples include migration directories, package entry points, and authentication configuration.

### Text detection

Text detection finds an exact text condition when parsing is not necessary.

Text detection must not replace AST detection when syntax gives better precision.

### AST detection

AST detection finds a syntax condition in source code.

Both state rules and change rules can use AST detection.

### Diff detection

Diff detection examines added, removed, or changed evidence.

Diff detection applies only to change rules.

### Repository inspection

Repository inspection compares files, packages, declarations, or generated artifacts.

Both state rules and change rules can use repository inspection.

## AST and change detection together

A change rule can parse changed code.

For example, Git can identify added migration code. The parser can then find a `DROP COLUMN` syntax node.

This rule is AST-powered, but its lifecycle is `change`.

The rule fingerprint must include normalized change evidence. It must not use only the final AST node.

## One standard or two standards

Use one standard when multiple detectors ask the same review question.

For example, one destructive migration rule can detect these operations:

- Drop a table.
- Drop a column.
- Rename data without a safe sequence.
- Run irreversible raw SQL.

One standard can have state and change detectors when both ask the same review question.

For example, one standard can have these detectors:

- A state detector supports adoption scans and current repository checks.
- A change detector finds new uses with precise change evidence.

Use two standards when the review questions or guidance differ.

Do not give one detector two lifecycles.

## Evaluation times

Evaluation time is separate from rule lifecycle.

The engine can run rules at these times:

- During an explicit check.
- After an edit.
- Before agent completion.
- Before a commit.
- In CI.

A state rule can run at all these times when the engine has the necessary files.

A change rule needs a defined comparison. The integration or CLI must give the base and head context.

## Finding contract

All rules produce one common finding contract.

The contract needs these conceptual fields:

```ts
interface Finding {
  readonly standardId: string;
  readonly detectorId: string;
  readonly lifecycle: "state" | "change";
  readonly fingerprint: Fingerprint;
  readonly message: string;
  readonly evidence: FindingEvidence;
}
```

This example does not define the final public API.

The evidence must give sufficient context for explanation, acceptance, and review.

The evidence must not require an AST node for all findings.

## Fingerprint requirements

A fingerprint identifies one applicable finding.

A state fingerprint must change when the evidence for the current condition changes materially.

A change fingerprint must identify the material before-and-after evidence.

Line numbers must not be the main fingerprint input.

Formatting-only changes must not invalidate an acceptance when they do not change the judgment evidence.

Two equal conditions in one file must have different fingerprints.

The team must define collision handling before it adds non-source findings.

## Declarative and imperative detection

Declarative matching is the preferred source rule API.

The `createOnce` API is the advanced source rule API.

Keep `createOnce` because some rules need state across nodes or files.

Document these lifecycle guarantees for `createOnce`:

- When the engine creates the visitor.
- Whether one visitor examines multiple files.
- The order of file and node visits.
- The behavior of `before` and `after` functions.
- The scope of mutable visitor state.

Do not use `createOnce` as the general API for change rules.

Change rules and state rules can share lower-level parsing services without sharing one visitor interface.

## Public API shape

The public API uses one `defineRule` function.

The `lifecycle` field discriminates the state and change contracts.

```ts
defineRule({
  lifecycle: "change",
  standard: publicApiStandard,
  detector: {
    id: "public-export-change",
    version: 1,
    detect(context) {},
  },
  binding: {
    id: "architecture/public-export-change",
    authority: "agent",
  },
});
```

The state variant exposes AST matching and state fixtures.

The change variant exposes before-and-after detection and change fixtures.

TypeScript must prevent invalid lifecycle and detector combinations.

## Fixtures

Each detector must have at least one report fixture.

A report fixture proves that one specified trigger path reports a finding.

Each detector must have a silent fixture for an important trigger boundary.

A silent fixture proves that one important similar case does not report a finding.

Fixtures are regression evidence. They do not prove that a detector finds all possible cases.

A state fixture contains one repository state or source state.

A change fixture contains a before state and an after state.

A repository fixture can contain multiple named files.

Use `mustReport` and `mustStaySilent` as the candidate API terms.

The rule test runner must show which detector made an unexpected finding.

A newly found missed case must add or change a regression fixture.

## Guidance and test evidence

Detector fixtures are test-only evidence. Normal agent feedback must not contain these fixtures.

Agent-facing guidance must show permitted solutions. It must not show known incorrect code as a teaching example.

The finding already shows the applicable repository evidence to the agent.

The rule author can use the review incident as the first report fixture.

The author does not need to predict all possible incorrect cases.

## Rejected alternatives

### AST as the rule type

This model makes an implementation capability the product boundary.

It cannot represent review concerns that exist only in a change.

### Source, file, change, project, session, and command scopes

This model mixes evidence location, lifecycle, and evaluation time.

It creates overlapping terms and unclear acceptance lifetimes.

### One general event rule

This model gives maximum flexibility, but it removes useful constraints.

It also makes fixtures, fingerprints, and integrations more difficult to define.

### Lifecycle on the standard

This model prevents one review question from using state and change detectors.

It couples durable policy to one detection and adoption strategy.

## 0.2 implementation

One discriminated `defineRule` API selects the state or change context.

A state detector can use syntax patterns or a tree visitor. It receives the current source file.

A change detector receives a normalized Git change set. The set contains the selected merge base, file status, before and after snapshots, and hunks.

The engine stops with an error when it cannot resolve the Git base.

The fixture API supports current source examples and before-and-after repository examples.

The fingerprint API has separate state and change schemes.

The project will reconsider this model if a real concern needs a third acceptance lifetime.

## Consequences

The finding domain can no longer require an AST node.

The engine must separate rule lifecycle from evaluation time.

The test API must support repository and before-and-after fixtures.

The acceptance fingerprint design must support state and change evidence.

The integration layer must supply change context when it runs change rules.

## Revision history

- 2026-08-10: The team proposed the state and change lifecycle model.
- 2026-08-10: The team separated detector fixtures from positive agent guidance.
- 2026-08-10: The team separated durable standards from executable detectors.
- 2026-08-10: The team moved lifecycle from the standard to each detector.
- 2026-08-10: The team accepted one discriminated `defineRule` API.
- 2026-08-10: The team completed the state and change pipelines for 0.2.
