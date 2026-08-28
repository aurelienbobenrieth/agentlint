# ADR-007: FoldKit review SPA

- Status: Accepted
- Date: 2026-08-10
- Depends on: [ADR-003](./adr-003-application-and-integrations.md)
- Related to: [ADR-006](./adr-006-review-workflows.md)

## Decision

The review application uses FoldKit as a client-side SPA framework.

The rewrite removes React, React Query, React Router, Base UI, and the separate UI package.

The application uses FoldKit, `@foldkit/ui`, Vite, Tailwind, and Effect Schema.

FoldKit and Effect use exact dependency versions.

## Context

The current review application uses React and two TanStack libraries.

The workspace also contains a separate package with many vendored React components.

The review workflow has explicit states, messages, effects, and transitions.

The backend already uses Effect.

The project permits a complete breaking rewrite before 0.2.

## Application model

One immutable Schema model contains all application state.

The model includes these areas:

- Review mode and transport.
- Loaded review payload.
- Finding filters and selection.
- Draft reasons and notes.
- Calibration labels.
- Pending commands.
- Errors and completion output.

All user and server events use discriminated messages.

One update function handles every state transition.

Side effects use named FoldKit commands.

## Review modes

The SPA supports `calibration` and `review` modes.

Calibration collects temporary labels and notes. It cannot create acceptances.

Review mode permits actions that satisfy the finding authority.

The transport is `attached` or `detached`.

Attached review can write acceptances through the local server.

Detached review produces portable output. It cannot claim remote persistence.

## UI functions

The application supports these functions:

- Group and filter findings.
- Show code or change context.
- Show compact guidance and references.
- Record acceptance reasons.
- Request changes with comments.
- Label calibration matches.
- Show prior lineage as stale context.
- Copy agent instructions.
- Download detached feedback.
- Download detached acceptance output.
- Finish a review with a clear summary.

## Wire contract

The HTTP and detached artifact payload use one versioned review state contract.

The application decodes all external data with Effect Schema.

The server contract remains independent from FoldKit types.

The detached artifact can provide the same state through an embedded global value.

Invalid input shows a clear failure state. It never creates an acceptance.

## Testing

Story tests verify model transitions and command production.

Scene tests verify accessible user workflows.

Server contract tests verify decoding and action results.

End-to-end browser tests verify attached and detached review.

## Dependency policy

FoldKit is pre-1.0 and can change APIs in minor releases.

The project pins FoldKit, its Vite plugin, its UI package, and Effect exactly.

Dependency upgrades are explicit changes with full application tests.

The application avoids FoldKit experimental APIs.

The domain and HTTP contracts do not depend on FoldKit.

## Rejected alternatives

### Keep the React application

This option reduces the immediate rewrite.

It keeps multiple state and UI libraries during a full product redesign.

### Embed FoldKit inside React

FoldKit supports embedding, but the project does not need incremental migration.

Embedding would keep both frontend architectures.

### Keep the separate UI package

The product has one application and no external UI consumer.

A private component package adds package boundaries without reuse.

### Server rendering

The review tool is a local interactive application.

It does not need search indexing or server-rendered pages.

## Consequences

The UI follows the same Effect concepts as the engine.

The repository removes a large vendored component surface.

The team accepts dependency maturity risk through exact pins and tests.

The application becomes a focused SPA instead of a reusable UI system.

## Revision history

- 2026-08-10: The project selected FoldKit for the complete review SPA rewrite.
