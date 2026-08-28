# ADR-004: Rule composition

- Status: Accepted
- Date: 2026-08-10
- Depends on: [PDR-001](./pdr-001-product-core.md)
- Related to: [ADR-001](./adr-001-rule-lifecycles.md)

## Decision

An effective rule is the composition of three objects:

1. A standard defines the durable review question.
2. A detector finds applicable evidence.
3. A repository binding selects the detector and effective policy.

The product can use `rule` as a user-facing name for this composition.

The public API uses one discriminated `defineRule` function.

The rule keeps standard, detector, and binding data in separate fields.

## Context

Some engineering standards apply across technologies.

For example, a bounded-query standard can apply to Prisma, Drizzle, SQL, and an internal data library.

Each technology needs different detection logic.

Repository architecture also changes the required paths, exclusions, and safe wrappers.

A package author cannot know the correct repository policy or acceptance authority.

The model must support useful packages without making their defaults universal policy.

## Standard

A standard defines one stable review question.

A standard contains these conceptual fields:

```ts
interface Standard {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly summary: string;
  readonly guidance: Guidance;
  readonly source?: SourceReference;
}
```

The standard identifier is the durable policy identity.

The standard revision identifies the semantic decision contract.

Increase the revision when decision criteria or permitted outcomes change.

Do not increase the revision for editorial changes that preserve the decision contract.

The identifier must not contain a technology name unless the policy is specific to that technology.

Guidance must explain the decision checks and permitted paths.

Guidance must not teach known incorrect code as an example.

A standard does not contain repository authority, file scope, or an enabled state.

A standard does not have a finding lifecycle.

## Detector

A detector identifies evidence for one standard.

A detector contains these conceptual fields:

```ts
interface Detector {
  readonly id: string;
  readonly standardId: string;
  readonly lifecycle: "state" | "change";
  readonly detect: DetectionFunction;
  readonly fixtures: DetectorFixtures;
  readonly version: number;
}
```

The detector identifier is unique within its package.

The detector identifier identifies one detection contract.

The detector version changes when normalized evidence semantics change.

Each detector has one lifecycle.

One standard can have many detectors. Those detectors can use different technologies and lifecycles.

A detector can accept configuration for repository architecture.

The configuration must not change the standard question.

Use a separate detector when configuration would change evidence semantics substantially.

## Repository binding

A repository binding creates the effective rule.

A binding selects these values:

- The standard.
- One detector instance.
- Detector configuration.
- Included and excluded repository scope.
- Acceptance authority.
- An optional local name.

A conceptual binding has this shape:

```ts
interface RuleBinding {
  readonly id?: string;
  readonly standard: Standard;
  readonly detector: Detector;
  readonly authority: "agent" | "human";
  readonly include?: ReadonlyArray<string>;
  readonly exclude?: ReadonlyArray<string>;
}
```

The repository owns each binding.

A package can recommend configuration and authority. The repository must select the effective values.

The repository can bind multiple detectors to one standard.

The repository can bind one detector more than once with disjoint scopes.

Each binding must have a stable identity when repeated detector use can cause ambiguity.

The engine must calculate a canonical digest from material binding configuration.

Material configuration includes detector options, included scope, and excluded scope.

The digest must ignore ordering or syntax differences that preserve effective configuration.

An authority change uses the authority compatibility check. Authority does not need to change the binding digest.

## Public authoring API

Rule authors use one `defineRule` function.

The lifecycle field selects the state or change detector contract.

A candidate state rule is:

```ts
defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-query",
    revision: 1,
    title: "Bound database queries",
    guidance: {},
  },
  detector: {
    id: "prisma/unbounded-query-state",
    version: 1,
    match: [],
    fixtures: {},
  },
  binding: {
    id: "data/prisma-bounded-query",
    include: ["apps/api/src/**"],
    authority: "agent",
  },
});
```

This structure gives one authoring object and preserves the three product identities.

A package can export a rule factory for one technology-specific detector.

The factory accepts repository options and returns a complete rule definition.

The public API does not need separate standard, detector, or binding constructors.

## Package contract

A rule package can export these objects:

- Standards.
- Rule factories for technology-specific detectors.
- Detector fixtures.
- Recommended configuration.
- Durable source references.

A rule package must not make a rule active by installation alone.

A package must document its detection assumptions.

These assumptions include framework versions, call shapes, wrappers, and expected repository scope.

A package must document known detection limits.

The core agentlint package does not ship product standards, detectors, or presets.

## Finding identity

A finding must identify the standard, detector, and binding that produced it.

The conceptual identity is:

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

The standard identifier selects guidance and durable intent.

The standard revision selects the semantic decision contract.

The detector identifier selects detection semantics.

The binding identifier selects repository policy and scope.

The binding digest identifies its material effective configuration.

The acceptance key must not use only the standard identifier.

## Multiple detectors and duplicate findings

Two detectors can find evidence for the same standard.

The engine must not merge findings only because their standard identifiers are equal.

Detector evidence can have different meaning or lifetime.

The repository should avoid overlapping bindings when practical.

A later deduplication feature needs an explicit evidence-equivalence contract.

Presentation code can group related findings under one standard. Grouping must not change gate state.

## Detector upgrades

A detector upgrade can change detection coverage without changing the standard.

The detector version must change when the upgrade changes normalized evidence semantics.

An upgrade must not silently keep an acceptance when evidence equivalence is unknown.

The engine can show a prior acceptance reason as lineage context.

A material standard revision or binding configuration change has the same conservative behavior.

[ADR-005](./adr-005-fingerprints-and-lineage.md) defines this behavior.

## Pressure tests

### Bounded database query

The standard asks whether a database operation has a justified bound.

Prisma, Drizzle, raw SQL, and internal libraries need different detectors.

A monorepo binding can limit a detector to one service and exclude a reviewed data-access layer.

The standard remains portable. Detector assumptions and repository policy remain explicit.

### Destructive migration

The standard asks whether a destructive schema change has a safe rollout plan.

A change detector can inspect added migration operations.

A state detector can inspect existing unexecuted migration files during adoption.

Both detectors use the same guidance. They keep different finding lifetimes.

### Public export change

The standard asks whether a public API change preserves intended compatibility.

One detector can compare package exports. Another can inspect generated API reports.

Repository bindings select public packages and ignored internal entry points.

### Local architectural convention

A local rule can compose all three objects through one convenience function.

The author does not need to create a package or reusable standard module.

The internal result still preserves separate identities.

## Rejected alternatives

### One rule object owns all data

This model is simple for local rules.

It couples durable intent, technology detection, repository scope, and authority.

It makes reusable packages either rigid or highly configurable.

### Package owns authority

The package author does not own the target repository workflow.

A recommended authority can help adoption. It cannot become active policy without repository selection.

### Standard owns lifecycle

A standard can need state and change detectors.

Lifecycle describes evidence lifetime, not durable intent.

### Automatic detector selection

Package inspection can suggest applicable detectors.

Automatic activation can apply the wrong assumptions or scope.

The repository must confirm each active binding.

### Technology-specific standards only

This model duplicates guidance and policy history across stacks.

Use a technology-specific standard only when the review question is technology-specific.

## 0.2 implementation

One `defineRule` call contains the standard, detector, and binding. The API does not use `bindRule`.

Each binding has an explicit identifier. A detector package owns its detector identifier namespace.

The state and change branches infer their detector function and option types from the lifecycle discriminator.

The binding digest contains include paths, exclude paths, and detector options.

The config does not inspect installed package metadata. The core does not suggest or install detectors.

Calibration produces temporary review feedback. It does not edit the binding or config.

## Consequences

The engine must resolve bindings before it evaluates detectors.

Finding output can group results by standard while it preserves detector identity.

Package documentation must distinguish standards, detectors, and recommended bindings.

The rule advisor must ask about stack and repository architecture before it selects a detector.

The test runner tests detectors. Repository checks test effective bindings.

The public API can remain short for local authors without hiding the internal model.

## Revision history

- 2026-08-10: The project accepted the standard, detector, and repository binding model.
- 2026-08-10: The project added semantic standard revisions and material binding digests.
- 2026-08-10: The project selected one discriminated `defineRule` authoring function.
