# ADR-003: Application surfaces

- Status: Accepted
- Date: 2026-08-10
- Depends on: [PDR-001](./pdr-001-product-core.md)
- Related to: [ADR-006](./adr-006-review-workflows.md)

## Decision

The 0.2 release has two application surfaces:

1. The CLI.
2. The local review SPA.

Shared application handlers contain all product behavior.

CI runs the CLI. The review HTTP server calls the same application handlers.

The release does not contain MCP or coding-harness adapters.

## Context

The development version contains CLI commands, MCP tools, a Claude Code hook, and review HTTP routes.

These surfaces duplicate selection, formatting, result state, and exit behavior.

The team does not yet know whether future harness integration needs product code.

A documented CLI command can be sufficient for many coding agents.

The product must prove its workflow before it designs a public integration protocol.

## CLI role

The CLI is the stable automation and local development interface.

The CLI owns these workflows:

- Check selected or complete work.
- Check Git changes against a base.
- Calibrate a rule without enforcement.
- Test rule fixtures.
- Explain a finding.
- Accept an agent-authority finding.
- List and clean acceptances.
- Start a human review session.
- Create a detached review artifact.

Every command returns a documented exit result.

Machine output uses a versioned data contract.

## Review SPA role

The SPA is an optional review surface for complex work.

It supports these workflows:

- Detector calibration.
- Local human acceptance.
- Requested changes and reviewer notes.
- Detached review of CI artifacts.
- Copyable agent instructions.

The SPA does not own finding, authority, or acceptance semantics.

The local HTTP server validates requests and calls shared application handlers.

[ADR-007](./adr-007-foldkit-review-spa.md) defines the SPA architecture.

## Shared application handlers

Application handlers own product use cases.

Examples include:

- Collect applicable findings.
- Join findings with current acceptances.
- Validate acceptance authority.
- Write current acceptance state.
- Produce calibration results.
- Produce review state and outcomes.
- Explain one finding.

The CLI and review server must not reimplement these decisions.

## Check views

A partial check examines selected files or changed work.

A complete check examines the full applicable repository view.

Partial checks never remove stale acceptances.

Complete checks can remove stale acceptances under [ADR-005](./adr-005-fingerprints-and-lineage.md).

Local and CI checks use equal finding and acceptance semantics.

Presentation and file selection can differ. Gate meaning cannot differ.

## Change input

Change rules compare a Git merge base with the current working tree.

The current side includes committed, staged, unstaged, and untracked content.

The CLI accepts an explicit base reference.

Without an explicit base, the CLI detects the repository default branch.

The engine returns a clear error when it cannot create the comparison.

The 0.2 release does not keep session-start snapshots.

## CI use

CI invokes the normal check command with a known base reference.

CI can write a portable review artifact when findings need human review.

CI does not require a hosted agentlint service.

CI must fail after an engine error, configuration error, or unresolved finding.

## Deferred integrations

The release removes these implementations:

- MCP server.
- Claude Code hook.
- Harness installer.
- Harness-specific event contract.

The project can reconsider an integration after a manual workflow proves a missing capability.

A future integration must remain a thin adapter over the CLI or shared handlers.

The project must not add a public integration protocol before an external consumer needs it.

## Rule authoring API

The TypeScript API exists for rule and package authors.

It does not expose application handlers or integration events.

The package publishes one discriminated `defineRule` function and config helpers.

The package does not publish product rules or presets.

## Error behavior

No surface can silently open a gate after an error.

The application result distinguishes these outcomes:

- Clean.
- Unresolved findings.
- Configuration error.
- Engine error.
- Invalid review input.

Adapters convert the semantic result to exit codes or HTTP responses.

## Rejected alternatives

### MCP in 0.2

MCP adds another public surface before the CLI workflow is stable.

No confirmed workflow needs it.

### Claude Code integration in 0.2

One harness adapter can bias the core architecture before the product workflow stabilizes.

Documentation and CLI commands can provide the first integration.

### General harness event

The project does not have evidence for a stable cross-harness event contract.

### UI as the primary interface

Small agent-authority findings work better in text.

The UI exists for human judgment, calibration, and larger review queues.

### Different local and CI gate rules

This model makes local success unreliable.

Only selection and presentation can differ.

## Reconsideration conditions

Reconsider MCP or a harness adapter when one condition occurs:

- A supported harness cannot run the CLI at the necessary checkpoint.
- A direct continuation channel materially improves the proven workflow.
- An external integration needs a stable programmatic contract.
- Documentation alone causes repeated integration failures.

## Consequences

The codebase removes several unproved product surfaces.

The CLI becomes the complete local and CI contract.

The SPA stays useful without coupling the engine to a coding agent.

Future harness work starts from demonstrated needs.

## Revision history

- 2026-08-10: The team proposed one application path and thin adapters.
- 2026-08-10: The team selected CLI and local SPA as the only 0.2 application surfaces.
