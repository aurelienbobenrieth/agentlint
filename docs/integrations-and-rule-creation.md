# Integrations and proactive rule creation

Working product direction for shortening the feedback loop between coding
agents and human review. This document records decisions and open questions;
it is not a release commitment.

## Product principles

- Keep the agentlint engine harness-agnostic. Integrations translate harness
  events into a small agentlint-owned contract.
- A rule either exists and is enforced, or it does not exist. There is no
  candidate, observation, warning-only, or promotion lifecycle.
- A proposed rule is an ordinary code diff under review. Once its definition
  and config are accepted, it participates in normal check and ledger gates.
- Use deterministic machinery for detection, fixtures, routing, checking, and
  evidence collection. Use the coding agent for semantic interpretation and
  rule authoring; agentlint itself remains model-free.
- Ask the developer for clarification when an ambiguity would materially
  change the trigger, guidance, scope, exceptions, or resolution policy.
- Prefer immediate feedback inside the agent loop, with pre-commit and CI as
  progressively later guarantees.

## Daily workflow

### 1. Detect a possible recurring concern

A concern can begin with explicit human feedback or a deterministic signal:

- A reviewer says the same kind of correction should apply in the future.
- Review feedback is marked as a recurring project concern.
- `.agentlint/review-feedback.md` contains a change request that may express a
  reusable standard.
- A configured global, file, change, session, or command trigger identifies a
  judgment point worth surfacing.

Proactive discovery produces only a transient suggestion:

```text
This feedback may describe a recurring project standard:
"Check downstream consumers before changing public exports."

Run /agentlint-rule-create to codify it.
```

It creates no candidate file, observation state, ledger record, or backlog.

### 2. Start rule creation explicitly

The preferred human-facing command is:

```text
/agentlint-rule-create Check consumers before changing package boundaries
```

Harnesses may expose different native syntax, but they invoke the same
rule-advisor workflow. The underlying agentlint CLI or MCP operation should
collect deterministic context without calling a model.

Examples of entry points:

- A developer invokes the command directly.
- A reviewer selects **Codify this as an agentlint rule** when requesting
  changes.
- An agent makes a proactive suggestion and the developer confirms it.

### 3. Establish shared understanding

Before writing code, the advisor scans the repository for existing rules,
linters, tests, architecture checks, relevant documentation, and concrete
examples. It answers discoverable questions itself.

When the concern is not completely clear, it asks targeted questions such as:

- What invariant should the rule enforce?
- Which concrete code change should trigger the guidance?
- What similar-looking case must remain valid?
- Which files, packages, or languages are in scope?
- Can an agent record a justified exception, or must a human approve it?
- What document, incident, issue, or review comment is the source of truth?

The advisor asks only questions whose answers can change the resulting rule.
It then restates the proposed contract:

```text
Standard: Public package-boundary changes require downstream-consumer review.
Trigger: A public export is added or removed under packages/*/src/index.ts.
Valid exceptions: Test-only exports and internal entry points.
Scope: TypeScript package entry points.
Resolution: Agent-resolvable with a concrete impact analysis.
Source: AGENTS.md#package-boundaries and PR review discussion.
```

The developer confirms or corrects this contract before authoring. The advisor
may proceed without a question only when the invariant, trigger, scope,
exceptions, and policy are unambiguous from repository evidence. It reports
any assumptions it made.

### 4. Author and prove the real rule

The advisor creates the actual rule and config change. Before handing it back,
it:

1. Adds invalid fixtures that must trigger.
2. Adds valid look-alikes that must remain silent.
3. Runs the rule fixtures.
4. Scans the relevant repository scope.
5. Reviews every current match for trigger applicability.
6. Narrows routing or matching when the blast radius is wrong.
7. Shows the developer the resulting files, matches, and enforcement policy.

If the rule cannot be made useful, the advisor removes the draft during the
same task. No intermediate product state survives.

### 5. Enforce immediately

Once the rule is accepted into config, it behaves like every other agentlint
rule: matching code must be fixed or receive an explicit disposition. Rules
with `resolution: "human"` require human approval.

A bad rule is edited or deleted through an ordinary reviewed code change.

## Rule sources

Rules should preserve durable provenance through guidance references whenever
possible:

- `AGENTS.md`, an ADR, or another repository document.
- An issue, incident report, specification, or stable PR discussion URL.
- A platform or library source of truth.

Git records who introduced the rule and why. Fixtures preserve the behavioral
evidence. Ephemeral review feedback can initiate authoring but should not be
the rule's only long-term source when a durable source can be created.

## First-class trigger scopes

AST matching remains agentlint's precision advantage, but it should not define
the product boundary. The rule model should eventually support:

- `node`: a syntax pattern matched.
- `file`: a relevant file was changed.
- `change`: a diff crossed a boundary or threshold.
- `project`: any configured project change occurred.
- `session`: startup, compaction, or completion.
- `command`: a relevant tool or command ran.

All configured rules remain enforceable. Session and integration-level
deduplication controls repeated presentation without weakening the exit gate.
The hash and ledger design for non-node findings requires an explicit
migration story before implementation.

## Harness-agnostic integrations

Replace the current single-harness framing with an explicit integrations
surface:

```text
agentlint integrations list
agentlint integrations install claude-code
agentlint integrations install codex
agentlint integrations install cursor
agentlint integrations install pi
agentlint integrations doctor
```

Each adapter normalizes its native payload into an agentlint-owned contract:

```ts
interface AgentlintIntegrationEvent {
  readonly harness: "claude-code" | "codex" | "cursor" | "pi";
  readonly phase: "after-edit" | "before-stop";
  readonly cwd: string;
  readonly files: ReadonlyArray<string>;
  readonly sessionId?: string;
}
```

The core owns file checking, finding formatting, session deduplication, and
exit semantics. Adapters own payload parsing and native installation only.

### Enforcement distance

Every capable integration should provide:

1. **After edit**: check affected files and return concise findings to the
   agent immediately.
2. **Before stop**: check the complete changed-file set and keep the agent
   working while blocking findings remain.
3. **Pre-commit**: provide a harness-independent local gate.
4. **CI**: provide the final merge guarantee.

Repeated findings should be deduplicated by session and finding hash. They
should reappear when the matched code changes and at the final stop gate.

### Distribution targets

- Claude Code: retain the PostToolUse adapter and add stop-gate behavior.
- Codex: package PostToolUse and Stop hooks, potentially through an agentlint
  Codex plugin containing hooks, skills, and MCP configuration.
- Cursor: install project hooks plus a shared `/agentlint-rule-create`
  command.
- Pi: install a project extension that subscribes to tool and turn lifecycle
  events and registers `/agentlint-rule-create`.

Integration contract fixtures should verify parsing and output for every
supported harness without coupling the engine to a harness SDK.

## Rule-advisor update

The current rule-advisor is strongest after a concern has already been
classified. Update it to activate for:

- Repeated code-review feedback.
- Requests to remember or enforce something next time.
- Recurring agent mistakes.
- Explicit `/agentlint-rule-create` invocations.
- Review feedback marked as a recurring concern.

Its workflow becomes:

1. Inspect existing enforcement and repository evidence.
2. Classify the concern as a linter, test, agentlint rule, learned note,
   integration policy, or one-off comment.
3. Clarify material ambiguity and confirm the rule contract.
4. Author the rule, fixtures, routing, policy, and durable references.
5. Run fixtures and a scoped repository scan.
6. Present the enforced impact or remove the unsuccessful draft.

## Review UI update

Add a **Codify this as an agentlint rule** action to change requests. The
action captures the comment, file, code context, reviewer, and stable review
URL when available, then starts the rule-advisor workflow through the active
integration.

It does not create a candidate lifecycle. Until the advisor authors and
configures a rule, no new product state exists.

## Rule quality signals

Disposition outcomes do not measure trigger quality. A broadly applicable
judgment rule may correctly produce many accepted or no-fix decisions.

Use these signals when refining a rule:

- Explicit reviewer feedback that the guidance did not apply at the match.
- Concrete valid examples added as regression fixtures.
- Repeated routing corrections.
- Fixture regressions.
- Current repository matches whose trigger is demonstrably wrong.

Keep any future statistics descriptive. Do not promote, demote, or delete
rules automatically from ledger disposition ratios.

## Non-goals

- A candidate or observation subsystem.
- Warning-only rules that agents can ignore indefinitely.
- Automatic semantic rule generation inside the model-free agentlint engine.
- Automatic promotion based on match or disposition counts.
- Treating every review comment as a reusable standard.

## Implementation slices

1. Update the rule-advisor description and workflow, including clarification
   and shared-understanding confirmation.
2. Define the normalized integration event contract and extract the existing
   Claude Code adapter behind it.
3. Add Codex, Cursor, and Pi installation adapters with post-edit and stop
   contract fixtures.
4. Add `/agentlint-rule-create` entry points through the integrations and MCP.
5. Connect review change requests to explicit rule creation.
6. Design first-class non-node triggers with a ledger/hash migration plan.

## Open questions

- Should the canonical CLI entry point be `agentlint rules create`, while
  `/agentlint-rule-create` remains the harness-native command?
- Should proactive suggestions run only from explicit review feedback, or can
  configured meta-rules request rule creation elsewhere?
- How should a review UI action start work when no active agent session exists?
- Which integration should ship first after extracting the common contract?
