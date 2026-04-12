# agentlint

[![CI](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml/badge.svg)](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@aurelienbbn/agentlint.svg)](https://www.npmjs.com/package/@aurelienbbn/agentlint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Stateless, deterministic CLI that bridges traditional linters and AI-assisted code review.

agentlint uses tree-sitter to parse code, runs visitor-based rules that flag suspicious patterns, and outputs structured reports with natural language instructions. The output is designed to be consumed by an AI coding agent (Claude Code, Cursor, etc.) that evaluates each finding in context.

## How it works

```
Phase 1 - Deterministic (agentlint)
  tree-sitter AST parsing -> visitor dispatch -> pattern match -> collect flags

Phase 2 - AI-evaluated (the calling agent)
  reads agentlint stdout -> evaluates each match per instructions -> acts
```

agentlint owns Phase 1 only. It does not call any AI model. It does not require an API key.

## Quick start

```bash
pnpm add @aurelienbbn/agentlint
```

Create `agentlint.config.ts`:

```typescript
import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const noNoiseComments = defineRule({
  meta: {
    name: "no-noise-comments",
    description: "Flags comments for AI evaluation",
    languages: ["ts", "tsx"],
    instruction: `Evaluate each comment. Is it noise or valuable?
Remove noise comments. Keep valuable ones.`,
  },
  createOnce(context) {
    return {
      comment(node) {
        const text = node.text.replace(/^\/\/\s*/, "").trim();
        if (text === "") return;
        context.flag({ node, message: `Comment: "${text.slice(0, 60)}"` });
      },
    };
  },
});

export default defineConfig({
  rules: { "no-noise-comments": noNoiseComments },
});
```

Run:

```bash
# Scan files changed in current branch
pnpm agentlint check

# Scan all files
pnpm agentlint check --all

# Scan specific files or globs
pnpm agentlint check src/utils.ts "src/**/*.tsx"

# List registered rules
pnpm agentlint list

# Mark flags as reviewed
pnpm agentlint review <hash...>
```

## Output format

```
agentlint v0.1.0 - 1 rule(s) triggered, 3 match(es)

━━━ no-noise-comments: Flags comments for AI evaluation (3 match(es)) ━━━

  [abc1234] src/utils.ts:5:1  // Increment the counter
  [def5678] src/utils.ts:12:1  // Helper function
  [ghi9012] src/utils.ts:18:3  // TODO: implement later

  ┌─ Instruction ─────────────────────────────────────────
  │ Evaluate each comment. Is it noise or valuable?
  │ Remove noise comments. Keep valuable ones.
  └───────────────────────────────────────────────────────

3 match(es) across 1 rule(s)
```

## CLI reference

### `agentlint check [files...] [options]`

| Flag                  | Description                             |
| --------------------- | --------------------------------------- |
| `--all`, `-a`         | Scan all files (not just git diff)      |
| `--rule`, `-r <name>` | Run only this rule                      |
| `--dry-run`, `-d`     | Show counts only, no instruction blocks |
| `--base <ref>`        | Git ref to diff against                 |

### `agentlint list`

Lists all registered rules with their metadata.

### `agentlint init`

Scaffolds a starter `agentlint.config.ts` file in the current directory.

### `agentlint review [hashes...] [options]`

Manages per-developer reviewed-flag state. When you run `agentlint check`, flags that have been marked as reviewed are automatically filtered out of the output.

| Flag          | Description                              |
| ------------- | ---------------------------------------- |
| `--all`, `-a` | Mark all current flags as reviewed       |
| `--reset`     | Wipe the state file (`.agentlint-state`) |

**Review workflow:**

1. Run `agentlint check` to see current flags.
2. After evaluating a flag, mark it as reviewed by passing its hash:
   ```bash
   pnpm agentlint review abc1234 def5678
   ```
3. To mark every current flag as reviewed at once:
   ```bash
   pnpm agentlint review --all
   ```
4. Reviewed flags are stored in `.agentlint-state` (a local file, not committed to git). Future `check` runs hide them automatically.
5. To start fresh and see all flags again:
   ```bash
   pnpm agentlint review --reset
   ```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup and how to write rules.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
