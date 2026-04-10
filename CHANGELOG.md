# Changelog

## 0.1.4

### Patch Changes

- [#14](https://github.com/aurelienbobenrieth/agentlint/pull/14) [`e131ec9`](https://github.com/aurelienbobenrieth/agentlint/commit/e131ec922e6f0a0fd1d4ac7247438ca28a953ea4) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Fix import path in scaffolded config and skill examples to use `@aurelienbbn/agentlint`

## 0.1.3

### Patch Changes

- [#7](https://github.com/aurelienbobenrieth/agentlint/pull/7) [`7dde9af`](https://github.com/aurelienbobenrieth/agentlint/commit/7dde9af19404076bbd09b4840d09f9a8738d2405) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Update `agentlint init` output to recommend pnpm instead of npx

## 0.1.2

### Patch Changes

- [#5](https://github.com/aurelienbobenrieth/agentlint/pull/5) [`f4c256d`](https://github.com/aurelienbobenrieth/agentlint/commit/f4c256d80917ed72b9def3fcc8b414436a99da95) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Update skills to recommend pnpm, add TanStack Intent CI workflows, and add skill validation to check script

## 0.1.1

### Patch Changes

- [#2](https://github.com/aurelienbobenrieth/agentlint/pull/2) [`2a7316d`](https://github.com/aurelienbobenrieth/agentlint/commit/2a7316d4b27d4e2a5554f532e2e500b8f6ec6df9) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Upgrade effect to 4.0.0-beta.44 and migrate from removed `effect/ServiceMap` to `Context.Service`

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-04-09

Initial public release of `agentlint` -- deterministic linting for AI agents.

### Added

- **CLI commands**
  - `agentlint check [files...]` -- scan files and output a structured report for AI agents
    - `--all` / `-a` flag to scan all files instead of only git-changed files
    - `--rule` / `-r` flag to run a subset of rules (comma-separated)
    - `--dry-run` / `-d` flag to show counts only, without instruction blocks
    - `--base <ref>` flag to diff against a specific git ref
  - `agentlint list` -- print all registered rules with metadata (description, languages, include/ignore patterns)
  - `agentlint init` -- scaffold a starter `agentlint.config.ts` configuration file
  - `agentlint review [hashes...]` -- mark flags as reviewed so they are filtered from future `check` output
    - `--all` / `-a` flag to mark every current flag as reviewed
    - `--reset` flag to wipe the review state file
- **Core engine**
  - Tree-sitter AST parsing with visitor-based rule dispatch
  - `defineRule` helper for authoring rules with typed visitor callbacks (e.g. `comment`, `function_declaration`)
  - `defineConfig` helper for creating typed configuration files
  - Git-diff scoping: by default only files changed in the current branch are scanned
  - Inline suppression via `// agentlint-ignore <rule>` comments
  - Deterministic flag hashing for stable deduplication across runs
  - Structured terminal reporter with per-rule instruction blocks
  - Dry-run mode for count-only output
  - Review state persistence to filter previously-reviewed flags
- **Public API** (`import { ... } from "agentlint"`)
  - `defineConfig` -- create a typed configuration object
  - `defineRule` -- create a typed rule definition
  - Type exports: `AgentReviewConfig`, `AgentReviewNode`, `AgentReviewRule`, `FlagOptions`, `FlagRecord`, `Position`, `RuleContext`, `RuleMeta`, `TreeSitterNodeType`, `VisitorHandler`, `Visitors`
