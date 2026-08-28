# PDR-001: Product core

- Status: Accepted
- Date: 2026-08-10
- Owners: agentlint maintainers
- Related to: [ADR-001](./adr-001-rule-lifecycles.md), [ADR-002](./adr-002-acceptance-model.md), [ADR-004](./adr-004-rule-composition.md)

## Decision

agentlint turns recurring human review judgment into deterministic, repository-owned gates for coding agents.

agentlint detects a judgment point. It gives the repository standard. It keeps the gate closed until the evidence changes or an acceptance with sufficient authority matches the exact finding.

A coding agent can help a person to write a rule. The agentlint engine does not call an AI model.

## Context

Coding agents do not always apply repository instructions at the applicable time. Human reviewers give the same feedback in many code reviews.

Linters enforce conditions with one correct answer. Tests enforce specified behavior. Some conditions need judgment. A reviewer must examine context, risks, or exceptions before the reviewer accepts the code.

Prompts and skills give guidance. They cannot make sure that guidance starts for each applicable code condition.

agentlint fills this gap. It combines deterministic detection, contextual guidance, and an explicit stored result.

## Users and priorities

The project solves these problems in this order:

1. Prevent repeated human review feedback.
2. Prevent agents from missing repository instructions.
3. Add human gates for sensitive changes.
4. Keep a reviewable record of accepted findings.

An individual developer with a coding agent and an engineer who defines team standards have equal priority. A platform team and a rule package author have lower priority.

The core works for one repository without a central service.

## Product promise

1. A repository owns its rules and its acceptance records.
2. The engine detects each configured condition with deterministic logic.
3. A finding gives short guidance for the applicable judgment.
4. The gate stays closed until the code changes or an authorized actor accepts the finding.
5. A material code change invalidates an acceptance.
6. Local checks and CI use the same gate semantics.
7. An agent cannot accept a human-authority finding through the agent command.

## Enforcement classes

Use a linter, test, type, schema, or CI check when one correct mechanical result exists.

Use agentlint when detection is deterministic and the correct result needs contextual judgment.

Use a human or AI reviewer when deterministic detection cannot find the condition reliably.

Do not use agentlint to replace a better mechanical check or a necessary semantic review.

## Rule model

An effective rule composes a standard, a detector, and a repository binding. [ADR-004](./adr-004-rule-composition.md) defines this composition.

The standard defines one durable review question, a revision, guidance, and an optional source reference. The standard identifier stays stable when the title or guidance text changes.

The detector finds evidence for that question. Each detector has one `state` or `change` lifecycle. [ADR-001](./adr-001-rule-lifecycles.md) defines the lifecycles.

The binding selects scope, options, and `agent` or `human` authority. The repository owns the binding. A package cannot impose authority or scope on a repository.

A detector can carry `mustReport` and `mustStaySilent` fixtures. Fixtures are regression evidence. They do not enumerate all possible cases. The engine never sends fixture code to the agent as guidance.

The agentlint package does not publish product rules or presets. It publishes the engine and the authoring API. Repositories and rule packages own the rules.

## Rule creation and enforcement

Rule creation is an agent-assisted authoring workflow. A proposed rule is a normal code change. agentlint does not keep a candidate rule state, an observation database, or a rule backlog.

The engine owns rule loading, detection, finding identity, acceptance validation, file and change selection, output, and exit codes.

The coding agent owns semantic interpretation, repository research, clarification questions, and the authoring of rules, fixtures, and guidance.

A merged and enabled rule enforces findings immediately. The core has no warning-only rule state. `agentlint rules test` runs fixtures. `agentlint rules scan --review` calibrates a detector against the current repository without creating acceptance state.

## Human authority and proposals

An `agent` binding permits agent acceptance. A `human` binding requires human acceptance. A human acceptance satisfies both policies.

The agent must fix the evidence, ask a human, or record a proposal with `agentlint propose`. A proposal shows the agent summary and diff next to the finding in `agentlint review`. A proposal never opens the gate.

The local human gate is a workflow boundary, not a security boundary. A process with repository write access can edit the config and the acceptance file. Git review makes those edits visible. Protected branches and provider reviews give a stronger boundary. The actor text in a record is audit information, not identity proof.

## Interfaces and state

The CLI is the primary interface. The core package contains no MCP server, harness hook, or provider SDK. Integrations call the CLI and read the exit code. Exit code `0` opens the gate. Exit code `1` reports unresolved findings. Exit code `2` reports a usage, configuration, or evidence error.

`agentlint review` serves a local review SPA for human decisions. The agent workflow does not need the UI. CI writes a detached review artifact with `check --review-output`. `acceptances import` validates decisions from that artifact against a new detector run.

`.agentlint/acceptances.jsonl` keeps only current acceptances. Git keeps history. [ADR-002](./adr-002-acceptance-model.md) defines the record.

## Rejected alternatives

AST linter only: This model is too narrow. Some review concerns exist only in a change. AST detection remains one capability.

Candidate rule lifecycle: This model adds product state before a rule exists. A rule becomes product state only when the repository accepts the code change.

Warning-only rules: This model lets agents ignore the same guidance without a result. A configured rule creates an enforced finding. A future distribution layer can add a time-limited observation period with an owner, an expiry, and promotion criteria.

Append-only ledger: This model makes the repository file grow with all historical results. Git already keeps history.

Built-in rule presets: This model divides product work between the engine and a small catalog. Repository-specific judgment is the primary value.

Learned notes: The 0.2 branch added non-blocking Markdown notes with file and text triggers. Notes add a second product model and weaken the meaning of agentlint output. Agents can search `AGENTS.md` and decision records instead. The project removed learned notes from the core.

## Reconsideration conditions

The project reconsiders observation periods when an organization sends one rule package to many repositories, a new rule finds a large backlog, or a central team owns rules for teams that did not author them.

The project reconsiders learned notes when users repeatedly request deterministic non-blocking context and the capability can stay separate from enforced output.

The project reconsiders provider-verified authority when a team needs identity proof that local review cannot give.

## Consequences

The project removes code that does not support the core workflow.

The project optimizes rule creation before it optimizes audit functions.

The acceptance model stays small. A new state needs different gate behavior.

The documentation describes agentlint as a judgment gate, not only as a linter.

## Revision history

- 2026-08-10: The project accepted the first product core after the 0.2 self-review session.
- 2026-08-10: The project separated detector fixtures from positive agent guidance.
- 2026-08-10: The project added enforcement classes, durable standards, and distributed rollout conditions.
- 2026-08-10: The project accepted standards, detectors, and repository bindings as separate product objects.
- 2026-08-10: The project required state and change detector workflows in the 0.2 baseline.
- 2026-08-28: Condensed and aligned with the 0.2 implementation.
