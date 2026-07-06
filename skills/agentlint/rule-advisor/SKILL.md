---
name: agentlint/rule-advisor
description: >
  Decide whether a concern belongs in agentlint and, when it does, create a
  rule with a declarative match pattern, assertive guidance, fixtures, and
  config-owned routing and resolution policy.
type: core
library: agentlint
library_version: "0.2.0"
sources:
  - "aurelienbobenrieth/agentlint:README.md"
  - "aurelienbobenrieth/agentlint:CONTRIBUTING.md"
---

# Rule Advisor

Classify first:

- Mechanical violation with one correct fix: use an existing linter, custom lint rule, type, schema, test, or codemod.
- Import or package boundary: use dependency analysis or a CI check.
- Runtime behavior: use tests or production monitoring.
- AST-detectable trigger where the right action needs judgment: use agentlint.
- Trigger detectable, but the action is consequential enough that only a human should sign off (data loss, deletion, auth): agentlint rule with `resolution: "human"`.

Before creating a rule, scan existing lint config, tests, architecture checks, and `.agentlint/config.ts` for overlap.

For agentlint rules:

- Use one rule for one judgment-worthy trigger.
- Prefer a declarative `match` over `createOnce`. Patterns are code-shaped and matched structurally: `$NAME` captures one node, `$_` matches without capturing, `$$$ARGS` matches remaining siblings. Constrain with `where: { has, notHas }`. A pattern that does not parse fails at compile time.
- Use a raw tree-sitter `query` when the pattern language cannot express the shape; use `createOnce` visitors only for stateful or cross-node logic.
- Always include `fixtures`: `invalid` snippets that must fire and `valid` look-alikes that must not (strings, comments, wrapper calls, suppressing properties). Validate with `agentlint rules test`.
- Keep routing in config `files`, `ignores`, `overrides`, or presets.
- Keep `persistence` and `resolution` in config `policy`. Reserve `resolution: "human"` for triggers a machine may flag but must never self-accept.
- Make guidance assertive; do not phrase it as a question or generic request.
- Put required decision criteria in `checks`; `check` prints them as normal agent feedback.
- Put boundary-case calibration in `examples`; `explain` prints them when the compact guidance is not enough.
- Put authoritative docs, specs, skills, or platform references in `refs`.
- Emit findings with concrete local messages; interpolate captures ($NAME) when it helps.

Template:

```ts
import { defineRule } from "@aurelienbbn/agentlint";

export const myRule = defineRule({
  id: "domain/my-rule",
  description: "Flags code that needs a judgment call.",
  guidance: {
    standard: "State the expected standard assertively.",
    checks: ["Name the short decision criterion agents should apply during check."],
    examples: [
      {
        label: "Boundary case",
        bad: "Show a tempting but wrong shape.",
        good: "Show the acceptable shape.",
      },
    ],
    refs: [{ type: "url", href: "https://example.com/source-of-truth" }],
  },
  match: [
    {
      pattern: "$OBJ.dangerousCall($$$ARGS)",
      where: { notHas: "safe: true" },
      message: "dangerousCall on $OBJ needs review.",
    },
  ],
  fixtures: {
    invalid: ["api.dangerousCall({})"],
    valid: ["api.dangerousCall({ safe: true })", "const s = 'api.dangerousCall in a string'"],
  },
});
```

Config shape:

```ts
import { defineConfig } from "@aurelienbbn/agentlint";
import { myRule } from "./rules/my-rule";

export default defineConfig({
  rules: {
    "domain/my-rule": myRule,
  },
  policy: {
    "domain/my-rule": { persistence: "ephemeral", resolution: "agent" },
  },
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["**/*.test.*"],
  overrides: [
    {
      files: ["src/generated/**"],
      rules: { "domain/my-rule": "off" },
    },
  ],
});
```

Validate with:

```bash
<agentlint-cmd> rules test --rule domain/my-rule
<agentlint-cmd> check --all --rule domain/my-rule
<agentlint-cmd> explain domain/my-rule
```

Run `rules test` first: it is the precision proof. Then review the `check` output: the message, standard, and checks should be enough for straightforward fixes.

Resolve `<agentlint-cmd>` from the repo package manager: npm `npm exec agentlint --`, pnpm `pnpm agentlint`, yarn `yarn agentlint`, bun `bun run agentlint`.
