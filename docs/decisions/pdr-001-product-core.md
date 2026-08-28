# PDR-001: Product core

- Status: Accepted
- Date: 2026-08-10
- Owners: agentlint maintainers

## Decision

agentlint turns recurring human review judgment into deterministic, repository-owned gates for coding agents.

agentlint detects a judgment point. It gives applicable guidance. It keeps the gate closed until the finding has an accepted result.

The coding agent can help a person to create a rule. The agentlint engine does not use an AI model.

## Context

Coding agents do not always apply repository instructions at the applicable time.

Human reviewers often give the same feedback in multiple code reviews.

Linters can enforce a condition that has one correct answer. Tests can enforce specified behavior.

Some conditions need judgment. A reviewer must examine context, risks, exceptions, or evidence before the reviewer accepts the code.

Prompts and skills can give guidance. They cannot make sure that guidance starts for each applicable code condition.

agentlint fills this gap. It combines deterministic detection with contextual guidance and an explicit result.

## Priority of user problems

The project uses this priority order:

1. Prevent repeated human review feedback.
2. Prevent agents from missing repository instructions.
3. Add human gates for sensitive changes.
4. Keep a reviewable record of accepted findings.

This order controls scope decisions. The project must not optimize the audit record before it improves the review loop.

## Primary users

The first two user groups have equal priority:

1. An individual developer who uses a coding agent.
2. An engineer who defines repository standards for a team.

These user groups have lower priority:

3. A platform team that manages standards for many repositories.
4. A person who publishes general rule packages.

The core must work for one repository without a central service.

## Product promise

The short product promise is:

> Turn recurring human review judgment into deterministic, repository-owned gates for coding agents.

The detailed product promise is:

1. A repository owns its rules and acceptance records.
2. The engine detects each configured condition with deterministic logic.
3. A finding gives short guidance for the applicable judgment.
4. The gate stays closed until the code changes or an authorized actor accepts the finding.
5. A code change invalidates an acceptance when it changes the applicable evidence.
6. CI gives the final repository gate.
7. Integrations give feedback as close as possible to the applicable work.
8. An agent cannot accept a finding that needs human authority through the supported agent workflow.

The product reduces the time between a risky change and corrective action.

The product prevents repeated low-quality agent output and sensitive operations from passing silently through the supported workflow.

## Core product model

An effective rule is the composition of a standard, a detector, and a repository binding.

The standard defines one durable review question and its guidance.

The detector finds evidence for that question. Each detector has one `state` or `change` lifecycle.

The repository binding selects detectors, scope, configuration, and authority.

One standard can have multiple detectors for different technologies or lifecycles.

The trigger can use different detection capabilities. AST detection is one capability, not the full product boundary.

The repository owns the effective policy. A package cannot impose authority or scope on a repository.

[ADR-004](./adr-004-rule-composition.md) defines this model.

## Enforcement classification

The rule advisor must put each concern in one of three enforcement classes.

### Mechanical enforcement

Use a linter, test, type, schema, or CI check when one correct mechanical result exists.

### Deterministic judgment gate

Use agentlint when detection is deterministic and the correct result needs contextual judgment.

### Semantic review

Use an AI reviewer or a human reviewer when deterministic detection cannot find the applicable condition reliably.

Do not use agentlint to replace a better mechanical check or a necessary semantic review.

## Standard and detector

The durable standard and its detector have different functions.

The durable standard explains the reason, boundaries, ownership, and history.

The detector identifies the exact condition that starts the judgment gate.

A consequential rule must reference a durable source when one is available.

The source can be an ADR, PDR, engineering standard, incident, issue, or stable review discussion.

The standard identifier must stay stable when titles or guidance text change.

The detector must not become the only historical explanation for a consequential standard.

## Progressive disclosure

Normal finding output must stay compact.

The output must include the finding message, the standard, and short decision checks.

Positive examples and full source documents must stay available on demand.

Integrations must select applicable guidance before they load full documents into agent context.

## Core workflow

The normal workflow has these steps:

1. A human gives recurring review feedback.
2. A human or an agent identifies the feedback as a possible repository standard.
3. The developer starts rule creation explicitly.
4. The coding agent examines repository evidence and existing enforcement.
5. The coding agent asks only questions that can change the rule contract.
6. The developer confirms the rule contract.
7. The coding agent creates the real rule and its fixtures.
8. The coding agent tests the rule and examines all applicable current matches.
9. The repository accepts the rule through a normal code review.
10. agentlint enforces the rule immediately.

The rule contract contains these items:

- The standard.
- The selected detector and its trigger.
- Valid similar cases.
- The repository scope.
- The acceptance authority.
- The source of the standard.

## Rule creation

Rule creation is an agent-assisted authoring workflow.

The agentlint engine does not generate a semantic rule. The engine can collect deterministic context for the coding agent.

A proposed rule is a normal code change. agentlint does not keep a candidate rule state.

The workflow does not create an observation database. It does not create a rule backlog.

The workflow removes an unsuccessful draft in the same task.

Each detector must contain test evidence.

A report fixture proves that one specified trigger path reports a finding.

A silent fixture proves that one important similar case does not report a finding.

Fixtures are regression evidence. They do not define all possible cases.

A newly found missed case must add or change a regression fixture.

Detector fixtures must not appear in normal agent feedback or explanations.

Agent-facing guidance must show permitted solutions. It must not show known incorrect code as a teaching example.

## Immediate enforcement and rollout

A repository-owned rule must enforce findings when the repository merges and enables the rule.

The rule branch, fixtures, repository scan, and code review provide the normal validation period.

The core does not contain a permanent warning-only rule state.

Distributed rule rollout can need a time-limited observation period in the future.

The project must reconsider observation when one or more conditions occur:

- One organization sends a rule package to many repositories.
- A new rule finds a large existing backlog.
- Teams need a migration period before enforcement.
- A new detector has uncertain behavior across different repositories.
- A central team owns rules for teams that did not author them.

A future observation period must have an owner, an expiry, and explicit promotion criteria.

Observation belongs to the distribution layer. It must not add another accepted finding state.

## Model boundary

The agentlint engine must not call an AI model.

The engine owns these functions:

- Rule loading.
- Deterministic detection.
- Finding creation.
- Acceptance validation.
- File and change selection.
- Result formatting.
- Exit results.

The coding agent owns these functions:

- Semantic interpretation.
- Repository research.
- Clarification questions.
- Rule authoring.
- Fixture authoring.
- Guidance authoring.

This boundary keeps the gate repeatable and testable.

## Enforcement distance

agentlint can run at different times.

These times do not define different rule types:

- An explicit developer check.
- After an edit.
- Before agent completion.
- Before a commit.
- In CI.

Early checks reduce the feedback time. CI gives the final repository result.

An integration can omit an early check when its agent harness does not support that check.

## Human authority

Some rules permit agent acceptance. Some rules require human acceptance.

A human rule creates a deliberate interruption in the agent workflow.

The supported agent workflow must not complete silently while a human finding stays unresolved.

The agent must fix the applicable evidence or ask a human for judgment.

The local interruption is not a security boundary. An agent with unrestricted file access can change project files.

Git permissions, protected branches, and provider reviews can give a stronger security boundary.

The product must describe this limit clearly. It must not claim that local actor text proves human identity.

## Repository state

agentlint keeps only the current acceptance state.

Git keeps the historical state.

The current file must contain one acceptance for each active rule and finding fingerprint.

The current file must not contain all events from the repository lifetime.

This model keeps the file size related to active acceptances.

## Distribution of rules

The agentlint package does not publish product rules or presets.

The package publishes the engine and the rule authoring API.

Users can create rules in one repository.

Organizations can publish private rule packages.

Other maintainers can publish open-source rule packages in the future.

The agentlint package can contain test fixtures and documentation examples. These examples must not appear as product presets.

## User interfaces

The CLI is the primary application interface.

Hooks and skills can call the CLI or shared application handlers.

MCP is an optional adapter. MCP must not define different product behavior.

The TypeScript engine API has lower product priority than the CLI.

The local review UI is optional. A user must not use the UI in the normal agent workflow.

The project must not add UI functions until the team confirms that the UI has a necessary product role.

## Success measures

The project uses this priority order for success:

1. A team converts recurring review feedback into a proved rule in a short time.
2. A repository uses agentlint without routine UI work.
3. A human-gated concern cannot pass the normal workflow without human acceptance.
4. An agent gets applicable guidance near the applicable work.
5. Users create useful repository rules without built-in product rules.

An immediate after-edit check is useful, but it is not necessary for all workflows.

A team can run a check after a refactor, during a test loop, before completion, or in CI.

## 0.2 baseline

The 0.2 release must give a complete testable baseline for state and change detectors.

The baseline must include these capabilities:

- Standards, detectors, and repository bindings.
- State and change detector evaluation.
- Detector fixtures and repository calibration.
- Versioned finding identity.
- Current acceptance storage.
- Agent and local human authority workflows.
- Early feedback and a final completion checkpoint.
- Equal local and CI gate semantics.
- A CLI-first review path.

The local UI can ship when it proves a necessary calibration or review role.

Provider-verified acceptance can ship after 0.2 without changing core gate semantics.

## Product exclusions

agentlint is not these products:

- A general AI agent framework.
- A probabilistic AI reviewer.
- A replacement for a mechanical linter.
- A replacement for tests.
- A general repository knowledge system.
- A permanent audit database.
- A rule marketplace.
- A UI-first review system.

## Removed capability: learned notes

The 0.2 development branch added learned notes.

A learned note is a Markdown file with file and text triggers. A check prints a non-blocking pointer when a note matches.

Learned notes keep contextual memory for agents. They do not create an enforced judgment point.

The product removes learned notes from the agentlint core.

### Reasons

- Learned notes do not support the primary user problem.
- Learned notes add a second product model.
- Non-blocking notes weaken the meaning of agentlint output.
- Agents can search `AGENTS.md`, ADRs, PDRs, and repository documentation.
- A separate skill can improve repository memory without coupling it to the gate.
- The product owner forgot this capability. This is evidence of weak product pull.

### Reconsideration conditions

The team can reconsider learned notes when one or more conditions occur:

- Users frequently request deterministic, non-blocking context.
- Repository search and agent instructions repeatedly fail to give necessary knowledge.
- User evidence shows that notes improve the primary review loop.
- The capability can stay separate from enforced rule output.

A future decision must compare a core implementation with a separate skill or package.

## Rejected product models

### AST linter only

This model is too narrow. Some recurring review concerns exist only in a change or in a repository relationship.

AST detection remains an important capability.

### Candidate rule lifecycle

This model adds product state before a rule exists.

A suggestion must stay transient. A rule becomes product state only after the repository accepts the code change.

### Warning-only rules

This model lets agents ignore the same guidance without a result.

A configured rule must create an enforced finding.

A future distribution layer can use time-limited observation before it enables the rule in target repositories.

### Append-only ledger

This model makes the current repository file grow with all historical results.

Git already keeps historical versions. agentlint needs only current acceptance state.

### Built-in rule presets

This model divides product work between the engine and a small rule catalog.

Repository-specific judgment is the primary value. The core package must focus on the engine and authoring workflow.

## Open product questions

These questions do not change the accepted product purpose:

- Which human acceptance interface must ship in 0.2?
- Must the local review UI stay in the main package?
- Which integration must ship after Claude Code?
- Does MCP give sufficient value when a harness can run the CLI?
- What is the minimum public TypeScript API?
- What work must finish before the 0.2 release?
- Which evidence must cause the project to add distributed observation?

## Consequences

The project can remove code that does not support the core workflow.

The project must optimize rule creation before it optimizes audit functions.

The engine must support future detection types without becoming a general event framework.

The acceptance model must stay small. The model must not add states without different gate behavior.

The documentation must describe agentlint as a judgment gate, not only as a linter.

The rule advisor must preserve the boundary between mechanical checks, agentlint rules, and semantic review.

## External evidence

Cloudflare uses approved and enforced states for its organization-wide Engineering Codex.

Approved standards give non-blocking findings. Enforced `MUST` requirements can block work.

This model gives distributed teams time to adopt standards and improve enforcement.

This evidence supports future distributed observation. It does not change immediate enforcement for repository-owned rules.

Source: [How Cloudflare enforces engineering standards using AI](https://blog.cloudflare.com/engineering-standards-enforcement/).

## Revision history

- 2026-08-10: The project accepted the first product core after the 0.2 self-review session.
- 2026-08-10: The project separated detector fixtures from positive agent guidance.
- 2026-08-10: The project added enforcement classes, durable standards, and distributed rollout conditions.
- 2026-08-10: The project accepted standards, detectors, and repository bindings as separate product objects.
- 2026-08-10: The project required state and change detector workflows in the 0.2 baseline.
