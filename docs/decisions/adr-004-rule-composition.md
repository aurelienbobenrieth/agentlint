# ADR-004: Rule composition

- Status: Accepted
- Date: 2026-08-10
- Depends on: [PDR-001](./pdr-001-product-core.md)
- Related to: [ADR-001](./adr-001-rule-lifecycles.md), [ADR-005](./adr-005-fingerprints-and-lineage.md)

## Decision

An effective rule is the composition of three objects:

1. A standard defines the durable review question.
2. A detector finds applicable evidence.
3. A repository binding selects the scope, the options, and the authority.

The product uses `rule` as the user-facing name for this composition.

The public API has one discriminated `defineRule` function. The rule keeps standard, detector, and binding data in separate fields.

## Context

Some engineering standards apply across technologies. A bounded-query standard can apply to Prisma, Drizzle, SQL, and an internal data library. Each technology needs different detection logic.

Repository architecture changes the required paths, exclusions, and safe wrappers. A package author cannot know the correct repository policy or acceptance authority.

The model must support reusable packages without making their defaults universal policy.

## Standard

A standard has an `id`, a `revision`, a `title`, an optional `summary`, `guidance`, and an optional `source` reference.

The standard identifier is the durable policy identity. Do not put a technology name in it unless the policy is specific to that technology.

The revision identifies the semantic decision contract. Increase it when the decision criteria or the permitted outcomes change. Do not increase it for editorial changes.

Guidance explains the decision checks and the permitted paths. Guidance must not teach known incorrect code as an example.

A standard does not contain authority, file scope, or an enabled state.

## Detector

A detector has an `id`, a `version`, optional `fixtures`, and detection logic.

The rule `lifecycle` selects the detector contract. A `state` detector declares a `match` list, a `createOnce` visitor factory, or both. A `change` detector declares a `detect` function.

The detector version changes when normalized evidence semantics change.

A detector receives the binding options. The options must not change the standard question. Use a separate detector when configuration would change evidence semantics substantially.

One standard can have many detectors with different technologies and lifecycles. The engine does not check that detector identifiers are unique. A detector package owns its identifier namespace.

## Repository binding

A binding has a required `id`, an `authority`, optional `include` and `exclude` globs, and optional detector `options`.

The repository owns each binding. A package can recommend configuration and authority. The repository selects the effective values.

Binding identifiers must be unique in the normalized configuration. The engine rejects a duplicate identifier. The repository can bind one detector more than once with different identifiers and disjoint scopes.

The engine calculates a binding digest from `include`, `exclude`, and `options`. It sorts the `include` and `exclude` lists and all object keys. It keeps the order of arrays inside `options`.

Equal scope lists in a different order give the same digest. Different glob syntax with equal effect gives a different digest.

Authority does not enter the digest. The authority compatibility rule checks it separately.

## Public authoring API

Rule authors use one `defineRule` function. The `lifecycle` field selects the state or change contract and the option types.

```ts
defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-query",
    revision: 1,
    title: "Bound database queries",
    guidance: "A production read has an explicit bound.",
  },
  detector: {
    id: "prisma/find-many-without-take",
    version: 1,
    match: { pattern: "$DB.findMany($$$ARGS)", where: { notHas: "take: $_" }, message: "$DB has no bound." },
  },
  binding: {
    id: "data/prisma-bounded-query",
    include: ["apps/api/src/**"],
    authority: "agent",
  },
});
```

`defineRule` validates the standard, the binding, and the detector shape. A state detector needs a `match` or a `createOnce`. A change detector needs a `detect` function. The API has no separate standard, detector, or binding constructors.

A package can export a rule factory that accepts repository options and returns a complete rule. The core package does not ship product standards, detectors, or presets. A package must document its detection assumptions and limits.

## Finding identity and duplicates

Each finding carries a `FindingSource` with the standard identifier and revision, the detector identifier and version, and the binding identifier and digest. [ADR-005](./adr-005-fingerprints-and-lineage.md) adds the evidence fingerprint. The acceptance key uses the complete source identity, never the standard identifier alone.

Two detectors can find evidence for the same standard. The engine does not merge findings with equal standard identifiers. Detector evidence can have a different meaning or lifetime.

Presentation can group related findings. Grouping does not change gate state.

A detector version change, a standard revision change, or a binding digest change invalidates existing acceptances. The engine can show a prior acceptance reason as lineage context.

## Rejected alternatives

### One rule object owns all data

This model is simple for local rules. It couples durable intent, technology detection, repository scope, and authority. Reusable packages become rigid or highly configurable.

### Package owns authority

The package author does not own the target repository workflow. A recommended authority helps adoption but cannot become active policy without repository selection.

### Standard owns lifecycle

A standard can need state and change detectors. Lifecycle describes evidence lifetime, not durable intent.

### Automatic detector selection

Package inspection can suggest applicable detectors. Automatic activation can apply the wrong assumptions or scope. The repository must confirm each active binding.

### Technology-specific standards only

This model duplicates guidance and policy history across stacks. Use a technology-specific standard only when the review question is technology-specific.

## Reconsideration conditions

Reconsider this model when one condition occurs:

- Detector option changes routinely need a new detector identifier.
- Two detectors for one standard need an explicit evidence-equivalence contract.

## Consequences

The engine resolves bindings before it evaluates detectors.

`rules test` runs detector fixtures. Repository checks test effective bindings.

Calibration produces temporary review feedback. It does not edit the binding or the configuration.

Package documentation must distinguish standards, detectors, and recommended bindings.

## Revision history

- 2026-08-10: The project accepted the standard, detector, and repository binding model.
- 2026-08-10: The project added semantic standard revisions and material binding digests.
- 2026-08-10: The project selected one discriminated `defineRule` authoring function.
- 2026-08-28: Condensed and aligned with the 0.2 implementation.
