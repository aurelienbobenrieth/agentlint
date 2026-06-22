---
name: agentlint/rule-advisor
description: >
  Decide whether a concern belongs in agentlint and, when it does, create a v0
  rule with assertive guidance, config-owned routing, and test coverage.
type: core
library: agentlint
library_version: "0.1.5"
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

Before creating a rule, scan existing lint config, tests, architecture checks, and `.agentlint/config.ts` for overlap.

For agentlint rules:

- Use one rule for one judgment-worthy trigger.
- Keep routing in config `files`, `ignores`, `overrides`, or presets.
- Keep persistence in config `policy`.
- Make guidance assertive; do not phrase it as a question or generic request.
- Emit findings with concrete local messages.
- Cover the rule with focused parsing or pipeline tests.

Template:

```ts
import { defineRule } from "@aurelienbbn/agentlint";

export const myRule = defineRule({
  id: "domain/my-rule",
  description: "Flags code that needs a judgment call.",
  guidance: {
    standard: "State the expected standard assertively.",
    checks: ["Name the sub-condition agents commonly miss."],
  },
  createOnce(context) {
    return {
      before(filename) {
        return !filename.endsWith(".generated.ts");
      },
      call_expression(node) {
        context.report({ node, message: "Explain the concrete local concern." });
      },
    };
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
    "domain/my-rule": { persistence: "ephemeral" },
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
<agentlint-cmd> rules list
<agentlint-cmd> check --all --rule domain/my-rule
<agentlint-cmd> explain domain/my-rule
```

Resolve `<agentlint-cmd>` from the repo package manager: npm `npm exec agentlint --`, pnpm `pnpm agentlint`, yarn `yarn agentlint`, bun `bun run agentlint`.
