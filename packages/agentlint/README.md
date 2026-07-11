# agentlint

[![CI](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml/badge.svg)](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@aurelienbbn/agentlint.svg)](https://www.npmjs.com/package/@aurelienbbn/agentlint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Deterministic triggers for contextual agent guidance and accountable resolution.

agentlint parses code with tree-sitter, runs declarative pattern rules, and prints concise findings for a coding agent or human to handle. It does not call an AI model and does not need an API key. Its job is to surface code patterns where the right outcome requires judgment, then block completion until each finding is fixed or explicitly resolved — with a committed, reviewable trail of who resolved what and why.

Classic linters handle mechanical violations with one correct fix. Skills and prompts activate probabilistically. agentlint covers the gap between them: **deterministic activation, judgment-based resolution, accountable ledger**.

## Model

```
code -> tree-sitter AST -> pattern matches -> findings
findings -> fix code, record a disposition, or request human approval -> rerun check
```

- A **finding** is a concrete matched instance, identified by a stable content hash.
- **Guidance** is the reusable standard attached to a rule. `standard` and short `checks` are the normal feedback; `examples` and `refs` calibrate edge cases through `explain` (incremental disclosure — nothing bloats base context).
- A **disposition** is an explicit outcome: `accepted`, `deferred`, `no-fix`, `approval-requested`, or `approved`.
- The **ledger** is `.agentlint/ledger.jsonl`, a committed JSONL record of dispositions. It is read mechanically on every `check`, so it gates merges instead of being write-only documentation. Dispositions are pinned to code hashes: change the code and the disposition invalidates automatically.
- **Human-gated rules** (`resolution: "human"`) cannot be self-accepted by agents. Agents fix the code or `--request-approval`; only a human `approve` (CLI or review UI) unblocks CI.
- **Learned notes** (`.agents/learn/*.md`) carry situational knowledge with trigger frontmatter. Matching notes surface as non-blocking context lines — determinism when a trigger exists, `rg` search as the fallback.

## Quick Start

```bash
npm install --save-dev @aurelienbbn/agentlint
npx agentlint init                          # config + gitignore
npx agentlint init --harness claude-code    # optional: PostToolUse hook
npx agentlint init --harness pre-commit     # optional: commit gate
```

Create or edit `.agentlint/config.ts`:

```ts
import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const boundedFindMany = defineRule({
  id: "data/bounded-find-many",
  description: "Flags findMany calls that need a bound or pagination review.",
  guidance: {
    standard: "Queries that grow with production data need an explicit bound, cursor, or pagination contract.",
    checks: ["Pagination, cursors, limits, or a documented finite dataset satisfy the standard."],
  },
  match: [
    {
      pattern: "$DB.findMany($$$ARGS)",
      where: { notHas: "take: $_" },
      message: "findMany on $DB has no explicit bound.",
    },
  ],
  fixtures: {
    invalid: ["await db.users.findMany({});"],
    valid: ["await db.users.findMany({ take: 50 });"],
  },
});

export default defineConfig({
  rules: {
    "data/bounded-find-many": boundedFindMany,
  },
  policy: {
    "data/bounded-find-many": { persistence: "ephemeral" },
    // Human-gated example: agents can request, only humans approve.
    // "danger/lossy-migration": { persistence: "durable", resolution: "human" },
  },
  files: ["src/**/*.{ts,tsx,js,jsx}"],
  ignores: ["**/*.test.*", "**/*.spec.*"],
});
```

Run the loop:

```bash
pnpm agentlint check
pnpm agentlint explain 1                     # examples, refs, ledger context on demand
pnpm agentlint resolve 1 --accept --reason "Bounded by org size, max ~200 rows."
pnpm agentlint check
```

Use `--format jsonl` when an agent harness wants one machine-readable object per finding.

## Writing rules

`match` is the primary authoring surface — you write code shapes, not visitor plumbing:

- `pattern` is **code-shaped** and matched structurally against the parsed file. Metavariables: `$NAME` captures one node, `$_` matches one node without capturing, `$$$ARGS` matches remaining siblings. `useQuery($$$ARGS)` matches the call by callee, not by substring — strings, comments, and wrapper calls never false-positive.
- `where: { has, notHas }` constrains the matched subtree with sub-patterns (`notHas: "limit: $_"` checks object properties structurally).
- `query` accepts a raw tree-sitter query for grammar-level precision. The `@match` capture designates the reported node.
- `message` interpolates captures: `"findMany on $DB has no explicit bound."`
- `fixtures.invalid` / `fixtures.valid` are inline proof of trigger precision, run by `agentlint rules test`. A rule ships with evidence of its own false-positive rate.
- `createOnce(context)` remains the imperative escape hatch for stateful or cross-node logic (visitors keyed by node type, `before`/`after` hooks).

Bad patterns fail loudly at compile time instead of silently never firing.

## CLI

### `agentlint check [files...]`

Scans changed files by default. Exit code `1` means blocking findings exist, not that the tool crashed.

| Flag             | Description                                              |
| ---------------- | -------------------------------------------------------- |
| `--all`          | Scan all files under the project                         |
| `--base <ref>`   | Compare changed files against a git ref                  |
| `--rule <id>`    | Run only one rule id or comma-separated ids              |
| `--format text`  | Print the default compact terminal output                |
| `--format jsonl` | Print one JSON object per displayed finding              |
| `--ci`           | Treat deferred and pending-approval findings as blocking |

Local `check` blocks unresolved findings only — an agent can finish its turn with an approval pending. `check --ci` also blocks deferred and pending-approval findings, so nothing merges without resolution.

### `agentlint resolve <selector>`

```bash
agentlint resolve 1 --accept --reason "Acceptable here because ..."
agentlint resolve 1 --defer --reason "Needs product decision after release."
agentlint resolve 1 --no-fix --reason "Generated vendor code cannot be edited."
agentlint resolve 1 --request-approval --reason "Drop is safe: data backfilled to users_v2."
```

Every resolution needs a reason. `--accept` is refused on `resolution: "human"` rules. Selectors come from the latest `check` (`1`, `[1]`, a hash, or `file:line`); resolution re-verifies only the affected file.

### `agentlint approve <selector>` (humans)

Records an `approved` disposition. Refused for `agent:` actors — the guard is accountability, not security: a forged actor is a visible, committed ledger line that PR review catches. Approvals stay valid only while the flagged code is unchanged.

### `agentlint review`

Opens a local review UI with a guided queue ordered by where human attention matters: pending approvals and human-gated findings first, then new agent dispositions since base (the self-acceptance audit surface), then the rest. Code context, guidance with examples/refs toggles, and a filterable findings list are one tab away. Approve, accept, defer, or mark no-fix in one click; an audit note is optional and a clear default is recorded when omitted. Change requests require actionable feedback, update `.agentlint/review-feedback.md` immediately, and stream progress to the terminal that launched the review. Unfinished notes and queue progress survive refreshes in browser-local session storage. `--base <ref>` scopes the ledger delta; `--no-open` and `--port <n>` are available for automation.

### `agentlint ledger`

```bash
agentlint ledger list
agentlint ledger review --base main    # pending approvals + dispositions since ref
agentlint ledger review --format jsonl # machine-readable, for PR bots
agentlint ledger gc --write            # prune stale records
```

`ledger review` is the PR surface: reviewers read reasons, not diffs of `.jsonl`. This repo ships a reusable workflow ([.github/workflows/ledger-review.yml](../../.github/workflows/ledger-review.yml)) that posts the delta as a sticky PR comment; in a consumer repo the equivalent is:

```yaml
- run: npx agentlint ledger review --base "origin/${{ github.base_ref }}" --format jsonl > ledger-review.jsonl
# render + upsert comment (see this repo's ledger-review.yml for the full recipe)
```

### `agentlint rules`

```bash
agentlint rules list [--files path]
agentlint rules test [--rule id]       # run fixtures: invalid => findings, valid => none
```

### `agentlint notes list`

Lists learned notes and their triggers. Notes live in `.agents/learn/*.md`:

```markdown
---
name: query-cache-gotcha
description: useQuery cache keys must include all filter params
triggers:
  files: ["src/**/*.tsx"]
  grep: "useQuery"
---

The body stays on disk until the reader opens it.
```

Matching notes appear as dim `Context notes` lines in `check` output — pointers, never bodies.

### `agentlint mcp`

Stdio MCP server exposing `check`, `explain`, `resolve`, `rules_list`, `rules_test`, and `ledger_review` as tools for any MCP-capable harness. `approve` is deliberately not exposed.

### `agentlint hook claude-code`

PostToolUse adapter: reads the hook payload from stdin, checks the edited file, and exits 2 with findings on stderr so Claude Code feeds them straight back to the model. Installed by `agentlint init --harness claude-code`.

## Enforcement layers

Determinism comes from the gates; hooks shorten feedback distance:

1. **CI** — `agentlint check --ci` (universal, non-negotiable)
2. **pre-commit** — `agentlint init --harness pre-commit` (harness-independent)
3. **in-loop hooks / MCP** — per-harness accelerators (optional)

## Config

Config owns routing and resolution policy. Rule definitions own detection and guidance.

```ts
import { basePreset, defineConfig, frontendPreset } from "@aurelienbbn/agentlint";

export default defineConfig({
  extends: [basePreset, frontendPreset],
  rules: {},
  policy: {
    "data/bounded-query": { persistence: "ephemeral" },
    "danger/lossy-migration": { persistence: "durable", resolution: "human" },
  },
  overrides: [
    { files: ["web/**/*.{tsx,jsx}"], rules: { "ui/query-state-coverage": "on" } },
    { files: ["**/*.test.*"], rules: { "ui/query-state-coverage": "off" } },
  ],
  notes: { dirs: [".agents/learn"] },
});
```

- `persistence` defaults to `ephemeral`; use `durable` for consequential project decisions.
- `resolution` defaults to `agent`; use `human` for findings a machine may flag but must not self-accept (lossy migrations, code deletion, auth changes).

## Testing rules programmatically

```ts
import { runRuleFixtures, runRuleOnSource } from "@aurelienbbn/agentlint";
```

Both are exported for plugin authors who want rule assertions inside their own vitest suites.

## Repository layout

This repo is a pnpm workspace: the publishable package lives in `packages/agentlint`, the review SPA in [apps/review](../../apps/review) (Vite + TanStack Router/Query) builds into its `dist/ui`, and the presentational component library lives in [packages/ui](../ui).

## More guides

- [Upgrade from 0.1.x to 0.2.0](../../MIGRATION.md)
- [Enforce agentlint with GitHub Actions](../../docs/github-actions.md)
- [Run the complete ten-minute demo](../../DEMO.md)

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for local development, Effect-first expectations, and rule authoring.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](../../SECURITY.md).

## License

[MIT](LICENSE)
