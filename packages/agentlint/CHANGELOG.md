# Changelog

## 0.2.0

### Minor Changes

- [#28](https://github.com/aurelienbobenrieth/agentlint/pull/28) [`8fbcccd`](https://github.com/aurelienbobenrieth/agentlint/commit/8fbcccdf08b28c67b9588a24de4e943bdb345700) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Move the project config file to `.agentlint/config.ts`.

  This is a breaking change: root-level `agentlint.config.*` files are no longer discovered, and `agentlint init` now creates `.agentlint/config.ts`.

- [#31](https://github.com/aurelienbobenrieth/agentlint/pull/31) [`39b5280`](https://github.com/aurelienbobenrieth/agentlint/commit/39b528036c002c04c6ed4a62b999feaa3762bf54) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Replace the reviewed-flag workflow with the v0 finding, guidance, and ledger loop.

  Breaking changes:
  - Rule definitions now use `id`, `description`, `guidance`, and `createOnce(context)` with `context.report(...)`.
  - Config owns `files`, `ignores`, `overrides`, `policy`, and `extends`; rule-level `meta`, `languages`, `include`, `ignore`, and `instruction` are removed.
  - `agentlint review` and `agentlint list` are replaced by `agentlint resolve`, `agentlint rules list`, and `agentlint ledger`.
  - `.agentlint-state` is removed. Explicit dispositions are written to committed `.agentlint/ledger.jsonl`; latest-check selector cache lives under gitignored `.agentlint/.cache/`.
  - `agentlint check` now supports `--format jsonl` and disposition-aware local versus CI gating.
  - `agentlint check` now includes short guidance checks in text and JSONL output; examples and refs remain available through `agentlint explain`.
  - The package exports the new rule/config/guidance/finding APIs plus the first internal presets and rules.

  Also updates `agentlint init`, README, contributor guidance, and packaged skills for the new workflow.

  The local review experience adds a guided queue, immediate durable actions, optional audit notes, refresh-safe drafts and progress, live agent feedback, and session-bound request protection.

### Patch Changes

- [#31](https://github.com/aurelienbobenrieth/agentlint/pull/31) [`a34d97d`](https://github.com/aurelienbobenrieth/agentlint/commit/a34d97d5e9eaa165109064409bc0c53e14c6d555) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Update the Effect beta runtime, TypeScript, Vitest, oxlint, and Changesets tooling baseline, add the Effect language-service TypeScript plugin, and keep the tree-sitter runtime pinned to the latest grammar-compatible release.

## 0.1.5

### Patch Changes

- [#22](https://github.com/aurelienbobenrieth/agentlint/pull/22) [`65f3598`](https://github.com/aurelienbobenrieth/agentlint/commit/65f3598555b4684e2be84ca0e7ffe761a86f7c24) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Detect the consumer's package manager in `agentlint init`, update skill guidance to recommend npm, pnpm, yarn, or bun commands that match the target repo, and fix packaged Tree-sitter WASM resolution so the published CLI loads grammars from `dist/wasm`

- [#18](https://github.com/aurelienbobenrieth/agentlint/pull/18) [`0b1424d`](https://github.com/aurelienbobenrieth/agentlint/commit/0b1424d4a730ee64ba3e2df5c6e1b934790b58ad) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Update agentlint skills: rule-advisor adds check-existing-enforcement step and skills-vs-rules classification, usage adds list docs and deduplicates rule template

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
  - Deterministic flag hashing for stable deduplication across runs
  - Structured terminal reporter with per-rule instruction blocks
  - Dry-run mode for count-only output
  - Review state persistence to filter previously-reviewed flags
- **Public API** (`import { ... } from "agentlint"`)
  - `defineConfig` -- create a typed configuration object
  - `defineRule` -- create a typed rule definition
  - Type exports: `AgentReviewConfig`, `AgentReviewNode`, `AgentReviewRule`, `FlagOptions`, `FlagRecord`, `Position`, `RuleContext`, `RuleMeta`, `TreeSitterNodeType`, `VisitorHandler`, `Visitors`
