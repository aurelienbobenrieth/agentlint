---
name: rule-advisor
description: >
  Decide whether recurring judgment belongs in agentlint and author a focused
  state or change rule with explicit identities, guidance, scope, authority,
  fixtures, and repository calibration.
metadata:
  type: core
  library: agentlint
  library_version: "0.1.5"
sources:
  - "aurelienbobenrieth/agentlint:packages/agentlint/README.md"
  - "aurelienbobenrieth/agentlint:CONTRIBUTING.md"
---

# agentlint rule advisor

First choose the right enforcement mechanism:

- Use a linter, type, schema, test, or codemod for a mechanical invariant with one correct result.
- Use architecture or dependency tooling for a mechanically provable boundary.
- Use runtime tests or monitoring for runtime behavior.
- Use agentlint when a deterministic trigger can identify evidence whose correct outcome still needs contextual judgment.

Before authoring, inspect existing checks, rules, tests, and durable repository documentation. Establish the invariant, trigger, important permitted cases, scope, authority, and source. Ask only questions that can change that contract.

Compose one effective `defineRule`:

- `standard.id` names durable intent; increment `revision` only when its meaning changes.
- `detector.id` names reusable detection technology; increment `version` when evidence equivalence or detection semantics change.
- `binding.id` names this repository use; choose `agent` or `human` authority and keep material options explicit.
- Choose `state` for current source or repository structure. Choose `change` when before/after evidence is essential.
- Prefer parsed patterns or tree-sitter queries for local syntax, `createOnce` for stateful analysis, and a normalized change detector for operations.
- Provide positive permitted examples in guidance. Do not teach agents a catalogue of tempting wrong answers.
- Add focused `mustReport` activation fixtures and `mustStaySilent` boundary fixtures. They are proof samples, not an exhaustive taxonomy.
- Emit concrete local messages. For change findings, choose stable `key`, material JSON `evidence`, and optional non-authoritative `lineageKey` deliberately.

Keep the complete rule in the repository config or an imported rule package:

```ts
const rule = defineRule({
  lifecycle: "state",
  standard: {
    id: "domain/standard",
    revision: 1,
    title: "Name the desired property",
    guidance: {
      standard: "State the desired property assertively.",
      checks: ["State the short judgment criterion."],
      examples: [{ code: "showThePermittedPath()" }],
    },
  },
  detector: {
    id: "stack/trigger",
    version: 1,
    match: { pattern: "$OBJ.operation($$$ARGS)", message: "$OBJ requires review." },
    fixtures: {
      mustReport: ["api.operation({})"],
      mustStaySilent: ["api.otherOperation({})"],
    },
  },
  binding: {
    id: "domain/standard",
    authority: "agent",
    include: ["src/**/*.ts"],
  },
});
```

Validate and calibrate:

```bash
<agentlint-cmd> rules test --rule domain/standard
<agentlint-cmd> rules scan --rule domain/standard --review
<agentlint-cmd> explain domain/standard
```

Review every current candidate. Refine detector, binding, guidance, and fixtures until the activation surface is useful. If the concern cannot be expressed usefully, remove the rule rather than leaving warning-only or candidate state behind.
