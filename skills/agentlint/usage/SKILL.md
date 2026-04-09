---
name: agentlint/usage
description: >
  Run agentlint CLI after code changes to catch patterns for AI evaluation.
  Activate when finishing code modifications, before committing, or when
  the developer asks to lint, scan, or review code with agentlint. Covers
  agentlint check, agentlint list, agentlint review, agentlint init,
  inline suppression, and output interpretation.
type: core
library: agentlint
library_version: "0.1.1"
sources:
  - "aurelienbobenrieth/agentlint:README.md"
  - "aurelienbobenrieth/agentlint:src/bin.ts"
---

# agentlint

Stateless, deterministic linter whose output is designed for you (an AI coding agent) to evaluate. It uses tree-sitter to parse code, runs visitor-based rules that flag suspicious patterns, and outputs structured reports with natural language instructions.

## Setup

```bash
pnpm add @aurelienbbn/agentlint
pnpm agentlint init
```

This creates `agentlint.config.ts` with a starter template. Add rules to the `rules` object.

## Core Patterns

### Run after code changes

```bash
# Default: scan files changed in current branch
pnpm agentlint check

# Scan specific files or globs
pnpm agentlint check src/utils.ts "src/**/*.tsx"

# Scan all files
pnpm agentlint check --all

# Only run a specific rule
pnpm agentlint check --rule no-noise-comments

# Dry-run (counts only, no instruction blocks)
pnpm agentlint check --dry-run

# Diff against a specific branch
pnpm agentlint check --base main
```

### Read and act on output

Output is grouped by rule. Each rule section contains:

1. **Match listings** with `[hash] file:line:col  source-line`
2. **Instruction block** explaining how to evaluate the matches

Process one rule section at a time:

1. Read the instruction block for the rule
2. Evaluate each match against the criteria in the instruction
3. For matches that are genuine issues: fix them
4. For matches that are acceptable: move on
5. Re-run `agentlint check` after fixes — resolved matches disappear

### Mark findings as reviewed

```bash
# Mark specific hashes as reviewed (they disappear from future output)
pnpm agentlint review abc1234 def5678

# Mark all current flags as reviewed
pnpm agentlint review --all

# Reset reviewed state (see all flags again)
pnpm agentlint review --reset
```

### Suppress inline

```typescript
// agentlint-ignore no-noise-comments -- explains the retry formula
const delay = baseDelay * Math.pow(2, attempt);
```

### Write a rule

```typescript
import { defineConfig, defineRule } from "agentlint";

const noTodos = defineRule({
  meta: {
    name: "no-todos",
    description: "Flags TODO comments for evaluation",
    languages: ["ts", "tsx"],
    instruction: "Evaluate each TODO. Convert actionable ones to issues, remove stale ones.",
  },
  createOnce(context) {
    return {
      comment(node) {
        if (node.text.includes("TODO")) {
          context.flag({ node, message: node.text.trim() });
        }
      },
    };
  },
});

export default defineConfig({
  include: ["src/**/*.{ts,tsx}"],
  rules: { "no-todos": noTodos },
});
```

## Common Mistakes

### HIGH Exit code 1 is not an error

Wrong:

```bash
# Treating non-zero exit as a failure and stopping
pnpm agentlint check || echo "agentlint failed"
```

Correct:

```bash
# Exit code 1 means findings exist — read and evaluate the output
pnpm agentlint check
# Then process the stdout, don't treat it as a crash
```

agentlint exits with code 1 when findings exist. This is expected behavior, not a crash. Read the output and evaluate each finding.

### HIGH Fixing all findings without reading instructions

Wrong: Blindly "fixing" every flagged line without reading the rule's instruction block.

Correct: Read the instruction block first. It tells you the evaluation criteria. Some findings are intentionally acceptable — the instruction explains which.

### MEDIUM Looping on already-evaluated findings

Wrong: Re-evaluating the same findings across multiple agentlint runs in one session.

Correct: Evaluate each finding once. If it persists after your fix, tell the developer rather than retrying. Use `agentlint review <hash>` to mark evaluated findings.

## Constraints

- Process one rule section at a time, not all findings at once
- Never attempt more than one fix per finding
- If agentlint still flags something after your fix, tell the developer
- When the instruction says "ask the developer," do that instead of guessing
- Do not loop on findings you already evaluated in this session
