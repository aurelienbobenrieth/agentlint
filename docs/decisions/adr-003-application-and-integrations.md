# ADR-003: Application surfaces

- Status: Accepted
- Date: 2026-08-10
- Depends on: [PDR-001](./pdr-001-product-core.md)
- Related to: [ADR-006](./adr-006-review-workflows.md), [ADR-007](./adr-007-foldkit-review-spa.md)

## Decision

The 0.2 release has two application surfaces: the CLI and the local review SPA.

Shared application handlers contain all product behavior. The CLI and the review HTTP server call the same handlers.

The release does not contain an MCP server or a coding-harness adapter.

## Context

An earlier development version contained CLI commands, MCP tools, a Claude Code hook, and review HTTP routes. These surfaces duplicated selection, formatting, result state, and exit behavior.

The team does not know whether a future harness integration needs product code. A documented CLI command is sufficient for many coding agents.

The product must prove its workflow before it designs a public integration protocol.

## CLI role

The CLI is the stable automation and local development interface.

The CLI owns these workflows:

- `check`: examine selected files, changed files, or the complete repository.
- `accept` and `approve`: accept one finding with agent or human authority.
- `propose`: record agent work on one finding for a human decision.
- `explain`: show one rule or one finding with its guidance and lineage.
- `rules list`, `rules test`, and `rules scan`: list bindings, run detector fixtures, and calibrate a rule without enforcement.
- `acceptances list`, `acceptances clean`, and `acceptances import`: maintain current acceptance state.
- `review`: start a local human review session, attached or from a detached artifact.
- `init`: create a starter configuration.

Every command exits with `0` (gate open), `1` (unresolved findings), or `2` (usage, configuration, or evidence error).

The `check` command has a `jsonl` output format. The review payload and the review artifact carry a version field.

## Review SPA role

The SPA is an optional review surface for complex work. It supports detector calibration, local human acceptance, change requests with reviewer notes, detached review of CI artifacts, and a handoff for the coding agent.

The SPA does not own finding, authority, or acceptance semantics.

The local HTTP server listens on loopback with a session token. It decodes each request and calls the shared review handlers.

[ADR-007](./adr-007-foldkit-review-spa.md) defines the SPA architecture.

## Shared handlers and check views

Application handlers own the product use cases: collect findings, join findings with current acceptances, validate acceptance authority, write acceptance state, produce calibration results, produce review state, and explain one finding.

The CLI and the review server must not reimplement these decisions.

A check is complete when it runs with `--all` and without file or rule selection. All other checks are partial.

A partial check never removes stale acceptances. A complete check removes them under [ADR-005](./adr-005-fingerprints-and-lineage.md).

Local and CI checks use equal finding and acceptance semantics. Presentation and file selection can differ. Gate meaning cannot differ.

## Change input

Change rules compare the merge base of `HEAD` and a base ref with the current working tree. The current side includes committed, staged, unstaged, and untracked content.

The CLI accepts an explicit `--base` ref. The configuration can set a default base.

Without a base, the engine reads `origin/HEAD`, then tries `origin/main`, `main`, `origin/master`, and `master`.

The engine returns a clear error when it finds no base or no merge base.

The release does not keep session-start snapshots.

## CI use

CI runs the normal `check` command with a known base ref. CI can write a portable review artifact with `--review-output`.

CI does not require a hosted agentlint service.

CI fails after an engine error, a configuration error, or an unresolved finding.

## Deferred integrations and authoring API

The release removed the MCP server, the Claude Code hook, the harness installer, and the harness-specific event contract.

A future integration must remain a thin adapter over the CLI or the shared handlers. The project must not add a public integration protocol before an external consumer needs it.

The package root exports `defineRule`, `defineConfig`, the evidence schemas, and tagged errors. Fixture test helpers live on the `@aurelienbbn/agentlint/testing` subpath so a config file does not load the parser. The review wire contract lives on the `@aurelienbbn/agentlint/contract` subpath. The package does not export application handlers, product rules, or presets.

## Rejected alternatives

### MCP in 0.2

MCP adds a public surface before the CLI workflow is stable. No confirmed workflow needs it.

### Claude Code integration in 0.2

One harness adapter can bias the core architecture before the workflow stabilizes. Documentation and CLI commands give the first integration.

### General harness event

The project has no evidence for a stable cross-harness event contract.

### UI as the primary interface

Small agent-authority findings work better in text. The UI exists for human judgment, calibration, and larger review queues.

### Different local and CI gate rules

This model makes local success unreliable. Only selection and presentation can differ.

## Reconsideration conditions

Reconsider MCP or a harness adapter when one condition occurs:

- A supported harness cannot run the CLI at the necessary checkpoint.
- A direct continuation channel materially improves the proven workflow.
- An external integration needs a stable programmatic contract.
- Documentation alone causes repeated integration failures.

## Consequences

The codebase removed several unproved product surfaces.

The CLI is the complete local and CI contract.

The SPA stays useful without coupling the engine to a coding agent.

Future harness work starts from demonstrated needs.

## Revision history

- 2026-08-10: The team proposed one application path and thin adapters.
- 2026-08-10: The team selected the CLI and the local SPA as the only 0.2 application surfaces.
- 2026-08-28: Condensed and aligned with the 0.2 implementation. Recorded the `testing` and `contract` subpaths.
