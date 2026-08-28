# ADR-007: FoldKit review SPA

- Status: Accepted
- Date: 2026-08-10
- Depends on: [ADR-003](./adr-003-application-and-integrations.md)
- Related to: [ADR-006](./adr-006-review-workflows.md)

## Decision

The review application in `apps/review` is a FoldKit client-side SPA.

The rewrite removed React, its data and routing libraries, and the separate UI package.

The application uses FoldKit, Vite, Effect Schema, plain CSS, highlight.js, and the Geist fonts.

FoldKit, its Vite plugin, and Vite use exact dependency versions.

## Context

The earlier review application used React and a vendored component package.

The review workflow has explicit states, messages, effects, and transitions. The backend already uses Effect.

The project permitted a complete breaking rewrite before 0.2.

## Application model

One immutable Schema model holds all application state.

The `screen` is `Loading`, `LoadFailed`, `Reviewing`, or `Finished`.

The model also holds the `queue` or `decisions` view, facets, grouping, the code view, the selected finding, per-finding drafts, toasts, the preferred editor, and the save state.

All user and server events are discriminated messages. One update function handles every transition. Side effects are named FoldKit commands.

A reason draft, a calibration label, and a note belong to one finding. A detached decision is a draft disposition until the review finishes.

## Modes and transport

The SPA reads `mode` and `transport` from the payload.

Calibration mode collects labels and notes. It cannot create acceptances.

Review mode accepts, requests changes, and withdraws decisions through `/api/action`.

Attached transport trusts the server and refetches `/api/state` after each action. Detached transport keeps decisions in the browser and builds the summary, the agent instructions, and the acceptance JSONL at finish.

## UI functions

- Split findings into a Queue and a Decisions view.
- Filter by status, authority, lifecycle, rule, and text query.
- Group by file or by rule.
- Show the focused range or the full file with syntax highlighting.
- Show guidance, examples, and references.
- Show the agent proposal and prior lineage.
- Open the finding in a detected editor or the file explorer.
- Copy finding context or agent instructions.
- Download acceptance JSONL in detached review.
- Drive everything from the keyboard, with `?` for the list.

## Persistence

The SPA saves drafts, filters, and layout to `localStorage` under a key derived from the payload.

A checkpoint action saves on demand. The page warns before unload while unsaved drafts exist. The loader ignores a saved state with another schema version.

## Wire contract

The HTTP payload and the detached artifact use one versioned review state contract.

The application decodes all external data with Effect Schema. Invalid input shows a failure screen and never creates an acceptance.

The loader reads an embedded global first and falls back to `/api/state`.

The server contract in `packages/agentlint` does not import FoldKit types.

## Testing

Vitest unit tests cover the update function and the syntax highlighter.

Server-side tests cover the payload builder, the action handler, the editor launchers, and request authorization.

## Rejected alternatives

**Keep the React application.** This option reduces the immediate rewrite. It keeps several state and UI libraries during a full product redesign.

**Embed FoldKit inside React.** FoldKit supports embedding. The project does not need an incremental migration.

**Keep the separate UI package.** The product has one application and no external UI consumer.

**Tailwind or a component kit.** One stylesheet is enough for a dark-only tool with a small surface. It keeps the build to one plugin.

**Server rendering.** The review tool is a local interactive application. It does not need search indexing or server-rendered pages.

## Reconsideration conditions

Reconsider this record when FoldKit reaches 1.0, when a second application needs shared components, or when browser tests become necessary for the review workflow.

## Consequences

The UI follows the same Effect concepts as the engine.

The repository removed a large vendored component surface.

The team accepts pre-1.0 dependency risk through exact pins and tests. Upgrades are explicit changes. The application is a focused SPA and not a reusable UI system.

## Revision history

- 2026-08-10: The project selected FoldKit for the complete review SPA rewrite.
- 2026-08-28: Condensed and aligned with the 0.2 implementation.
