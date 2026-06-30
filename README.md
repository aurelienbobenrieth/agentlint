# agentlint

[![CI](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml/badge.svg)](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@aurelienbbn/agentlint.svg)](https://www.npmjs.com/package/@aurelienbbn/agentlint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Deterministic triggers for contextual agent guidance and accountable resolution.

agentlint parses code with tree-sitter, runs visitor-based rules, and prints concise findings for a coding agent or human to handle. It does not call an AI model and does not need an API key. Its job is to surface code patterns where the right outcome requires judgment, then block completion until each finding is fixed or explicitly resolved.

## Model

```
code -> tree-sitter AST -> rule visitors -> findings
findings -> fix code or record a disposition -> rerun check
```

- A finding is a concrete matched instance.
- Guidance is the reusable standard attached to a rule. `standard` and short `checks` are the normal agent feedback; `examples` and `refs` calibrate edge cases through `explain`.
- A disposition is an explicit outcome: accepted, deferred, no-fix, or approved.
- The ledger is `.agentlint/ledger.jsonl`, a committed JSONL record of resolved findings.
- `.agentlint/.cache/` stores latest-check selectors and is gitignored.

## Quick Start

Install with the package manager already used by the repo:

```bash
pnpm add -D @aurelienbbn/agentlint
pnpm agentlint init
```

Create or edit `.agentlint/config.ts`:

```ts
import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const noNoiseComments = defineRule({
  id: "comments/no-noise",
  description: "Flags comments that need a value judgment.",
  guidance: {
    standard: "Comments should add durable context beyond the code.",
    checks: [
      "Remove comments that only restate obvious implementation details.",
      "Keep comments that explain non-obvious constraints, external contracts, or tradeoffs.",
    ],
  },
  createOnce(context) {
    return {
      comment(node) {
        const text = node.text.replace(/^\/\/\s*/, "").trim();
        if (text.length === 0) return;
        context.report({ node, message: `Comment: "${text.slice(0, 60)}"` });
      },
    };
  },
});

export default defineConfig({
  rules: {
    "comments/no-noise": noNoiseComments,
  },
  policy: {
    "comments/no-noise": { persistence: "ephemeral" },
  },
  files: ["src/**/*.{ts,tsx,js,jsx}"],
  ignores: ["**/*.test.*", "**/*.spec.*"],
});
```

Run the loop:

```bash
pnpm agentlint check
pnpm agentlint explain 1 # when examples, refs, or ledger context are needed
pnpm agentlint resolve 1 --accept --reason "The comment explains a non-obvious integration constraint."
pnpm agentlint check
```

Use `--format jsonl` when an agent harness wants one machine-readable object per finding.

## CLI

### `agentlint check [files...]`

Scans changed files by default. Exit code `1` means unresolved findings exist, not that the tool crashed. Text output includes each finding's local message, compact standard, and short checks. JSONL includes the same actionable guidance for agent harnesses.

| Flag             | Description                                 |
| ---------------- | ------------------------------------------- |
| `--all`          | Scan all files under the project            |
| `--base <ref>`   | Compare changed files against a git ref     |
| `--rule <id>`    | Run only one rule id or comma-separated ids |
| `--format text`  | Print the default compact terminal output   |
| `--format jsonl` | Print one JSON object per displayed finding |
| `--ci`           | Treat deferred findings as blocking         |

Local `check` blocks unresolved findings. `check --ci` blocks unresolved and deferred findings. Accepted, no-fix, and approved findings do not block while their hash still matches current code.

### `agentlint explain <rule-id|selector>`

Prints full guidance on demand, including examples and refs. Use selectors from the latest `check` output, such as `1`, `[1]`, a full hash, or `file:line` when unambiguous.

### `agentlint resolve <selector>`

Records a disposition in `.agentlint/ledger.jsonl`.

```bash
agentlint resolve 1 --accept --reason "Acceptable here because ..."
agentlint resolve 1 --defer --reason "Needs product decision after release."
agentlint resolve 1 --no-fix --reason "Generated vendor code cannot be edited."
```

Every resolution needs a reason. Re-running the same disposition is idempotent.

### `agentlint rules list`

Lists registered rule ids, descriptions, configured persistence, compact guidance, and whether each rule is enabled for an optional file:

```bash
agentlint rules list
agentlint rules list --files src/page.tsx
```

### `agentlint ledger`

```bash
agentlint ledger list
agentlint ledger list --rule comments/no-noise
agentlint ledger gc
agentlint ledger gc --write
```

`ledger gc` defaults to a dry run. Use `--write` to prune stale records whose findings no longer appear in current code.

## Config

Config owns routing and resolution policy. Rule definitions own only detection and guidance.

```ts
import { basePreset, defineConfig, frontendPreset } from "@aurelienbbn/agentlint";

export default defineConfig({
  extends: [basePreset, frontendPreset],
  rules: {},
  policy: {
    "data/bounded-query": { persistence: "ephemeral" },
    "ui/query-state-coverage": { persistence: "ephemeral" },
  },
  overrides: [
    {
      files: ["web/**/*.{tsx,jsx}"],
      rules: {
        "ui/query-state-coverage": "on",
      },
    },
    {
      files: ["**/*.test.*"],
      rules: {
        "ui/query-state-coverage": "off",
      },
    },
  ],
});
```

Persistence defaults to `ephemeral`. Use `durable` for findings that represent consequential project decisions.

## Learned Notes

Use `.agents/learn/` for rare, expensive debugging knowledge that should be searchable later but should not enter base context. Search it with `rg` when a bug looks familiar or platform-specific. Add a short note only after non-obvious investigation, using the template in `.agents/learn/_template.md`.

Learned notes are separate from `.agentlint/ledger.jsonl`; the ledger records finding dispositions only.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development, Effect-first expectations, and rule authoring.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
