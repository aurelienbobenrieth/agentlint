# Changelog

## 0.5.1

### Patch Changes

- [#63](https://github.com/aurelienbobenrieth/agentlint/pull/63) [`b0406a2`](https://github.com/aurelienbobenrieth/agentlint/commit/b0406a23a718d570789356bd67de435f22bd6e7f) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Upgrade Effect and its Node platform packages to the stable `4.0.0` release. Consumers that pin `@effect/platform-node-shared` alongside agentlint should move that pin to `4.0.0`.

## 0.5.0

### Minor Changes

- [#61](https://github.com/aurelienbobenrieth/agentlint/pull/61) [`8e433db`](https://github.com/aurelienbobenrieth/agentlint/commit/8e433db4bc39026519d7a3d2c88d90226e5362e5) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Reformatting no longer reopens accepted state findings. State fingerprints move to `source-structure` v4, which ignores what a formatter rewrites: line breaks, trailing commas, semicolons, quote style and escapes, redundant parentheses, `(x) =>` vs `x =>`, a union's leading `|`, number spelling, `"key"` vs `key`, `new Foo` vs `new Foo()`, JSX line breaks and `{" "}`, and comment layout. Identifiers, literal values, operators, and the tree shape still invalidate a decision. On 87 real files reformatted with oxfmt and Prettier, a print width of 80 or 120 changed 82 to 86% of v3 state fingerprints, and another quote, semicolon, or trailing-comma setting changed all of them; v4 changed none.

  Existing decisions carry over without a new review. A `source-structure` v3 acceptance or proposal keeps opening the gate while it equals the v3 fingerprint the engine computes for the finding now, and the first `check --all` moves it to v4 with its reason, actor, and date ("N acceptances moved to the current evidence fingerprint"). Run that check once after upgrading, before reformatting: a reformat first changes the v3 fingerprint, and those decisions are asked for again. Detached artifacts from earlier versions still import. Change rules are unaffected: their `git-change` evidence is whatever the detector reports.

- [#59](https://github.com/aurelienbobenrieth/agentlint/pull/59) [`b37c17d`](https://github.com/aurelienbobenrieth/agentlint/commit/b37c17d3c4eab6f9a5e7d79f35a04ea7ef6a4f5a) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - `agentlint review` starts scanning as soon as it listens, shows "Analyzing N files…" with a progress bar instead of a blank loader, and reuses one scan for reloads and decisions until a file some rule can see, or the compared commits, change. Reloading the page or opening the review link again, even from another page, keeps the session: the link now only loads the page, and the page trades its token for the session cookie through `POST /api/session`, so a prefetch or link preview can no longer spend it. A second browser without the cookie is still refused. `@aurelienbbn/agentlint/contract` exports the `ReviewProgress` and `ReviewSessionRequest` schemas for the new `/api/progress` and `/api/session` endpoints.

### Patch Changes

- [#59](https://github.com/aurelienbobenrieth/agentlint/pull/59) [`b37c17d`](https://github.com/aurelienbobenrieth/agentlint/commit/b37c17d3c4eab6f9a5e7d79f35a04ea7ef6a4f5a) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - `check` and `review` read a branch's changes with a constant number of Git processes instead of three per changed file: one `cat-file --batch` for the baseline side and one `git diff` per command-line-sized run of paths. On a branch changing about 440 files, `check --all` fell from about 15 s to under 8 s on Windows, where each Git process costs the most. Findings and their fingerprints are unchanged; an equivalence test runs the previous implementation beside the new one over every kind of change. Fingerprint digests also skip Effect Schema's per-string encoder, which produced the same JSON, and a file's structure is digested once for all the rules that report in it.

- [#60](https://github.com/aurelienbobenrieth/agentlint/pull/60) [`ed96153`](https://github.com/aurelienbobenrieth/agentlint/commit/ed961539e98808d5751d3056a3727da308934f32) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - `check --all`, `next`, and `acceptances clean` against a merge base other than the default branch's no longer remove change-rule acceptances and proposals. Such a check sees a change finding only relative to its own base, so it could not tell the finding was gone: a check against a parent branch removed acceptances recorded against `origin/main`, and the next check against `origin/main` reopened them. Stale state records still go on any complete check, and stale change records on a complete check against the default branch (`origin/HEAD`, else `origin/main`, `main`, `origin/master`, `master`), however `--base` or config `base` spells it. Scripts that snapshot and restore `.agentlint/acceptances.jsonl` and `proposals.jsonl` around a narrower-base check can go.

## 0.4.0

### Minor Changes

- [#55](https://github.com/aurelienbobenrieth/agentlint/pull/55) [`b45d29d`](https://github.com/aurelienbobenrieth/agentlint/commit/b45d29d095c6771f8fe88cd606873e92d3f9f165) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - TSX files parse with tree-sitter-typescript 0.23.2 instead of its 0.20 build in tree-sitter-wasms, which rejected a `&` inside a JSX string attribute, such as Tailwind's `className="[&_svg]:size-4"`, and failed the check with "Parse failed: syntax is incomplete or unsupported by the grammar". TypeScript files stay on 0.20: 0.23.2 rejects a tagged template with an object type argument (`` sql<{ id: string }>`…` ``). In TSX, a fragment (`<>…</>`) is now a `jsx_element` without a tag name, so `jsx_fragment` is gone from the node types.

  Upgrading can close the gate once. A state fingerprint digests its whole file's syntax tree, so a TSX file the two grammars parse differently gives its findings new fingerprints: their acceptances become stale and are removed, and the findings need accepting again. TypeScript, JavaScript, and JSON fingerprints do not change.

## 0.3.3

### Patch Changes

- [#51](https://github.com/aurelienbobenrieth/agentlint/pull/51) [`7fc45f0`](https://github.com/aurelienbobenrieth/agentlint/commit/7fc45f02ef7eab436d97a5709d69e50b8d84b78c) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Upgrade Effect and its Node platform packages to `4.0.0-rc.116`. Consumers that pin `@effect/platform-node-shared` alongside agentlint should move that pin to rc.116.

## 0.3.2

### Patch Changes

- [#49](https://github.com/aurelienbobenrieth/agentlint/pull/49) [`046588c`](https://github.com/aurelienbobenrieth/agentlint/commit/046588c905837f37049ea4c77b14dd8ca169d1dc) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - The `setup` Stop hook (`agentlint-gate.mjs`) now gates only a turn that edited files. A question or a review asked after earlier coding ends normally instead of being handed the open findings, which are often another agent's work in progress. Codex edits made through code mode's `exec` tool (an `apply_patch` inside its input) now count as edits. Copy the new `agentlint-gate.mjs` over `.agentlint/hooks/agentlint-gate.mjs` to pick this up.

## 0.3.1

### Patch Changes

- [#42](https://github.com/aurelienbobenrieth/agentlint/pull/42) [`50127bd`](https://github.com/aurelienbobenrieth/agentlint/commit/50127bd83276ad456e89fd48e5445de44b8781b6) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Store writers now wait up to 10 seconds for a busy `.agentlint/*.lock` instead of about 2 seconds, so concurrent `accept`, `propose`, and outcome writes on a slow machine no longer fail with "The store is locked". An orphaned lock still fails closed, now after the longer wait.

## 0.3.0

### Minor Changes

- [#40](https://github.com/aurelienbobenrieth/agentlint/pull/40) [`49c41f2`](https://github.com/aurelienbobenrieth/agentlint/commit/49c41f2e4ab641755f6f0583166e516548aac8fe) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Reject configs where two rules share a standard id but differ in its revision, title, summary, source, or guidance. Loading fails with `ConfigError` reason `conflicting_standard`, naming the standard and both binding ids. Share one `standard` object between the rules. An optional field set to `undefined` counts as absent.

## 0.2.2

### Patch Changes

- [#35](https://github.com/aurelienbobenrieth/agentlint/pull/35) [`b092937`](https://github.com/aurelienbobenrieth/agentlint/commit/b092937ab65e14339967b86e586ab9a5b74e4c17) Thanks [@dependabot](https://github.com/apps/dependabot)! - Build and publish with current GitHub Actions: checkout 7, setup-node 7, pnpm action-setup 6, and changesets/action 2.

## 0.2.1

### Patch Changes

- [#37](https://github.com/aurelienbobenrieth/agentlint/pull/37) [`5c8eadf`](https://github.com/aurelienbobenrieth/agentlint/commit/5c8eadfde53d3a6ac3a0bac8f50eb3549d5a125c) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Show the CI, npm version, and license badges on the npm package page.

## 0.2.0

### Minor Changes

- [#34](https://github.com/aurelienbobenrieth/agentlint/pull/34) [`d221bc1`](https://github.com/aurelienbobenrieth/agentlint/commit/d221bc11ba048040b289d610abd5bca77805c7b8) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - **Breaking:** 0.2 replaces the 0.1 flag-and-review workflow with an acceptance gate. There is no automated migration.

  1. Delete `.agentlint-state`. Reviewed hashes are not carried over; record fresh acceptances with `agentlint accept` or `agentlint approve`.
  2. Move `agentlint.config.*` to `.agentlint/config.ts`. Root-level config files are no longer discovered, and `agentlint init` creates `.agentlint/config.ts`.
  3. Rewrite each rule with `defineRule`. `meta.name`, `languages`, `instruction`, `include`, and `ignore` become a revisioned `standard`, a versioned `detector`, and a `binding` with scope and authority. `rules` in `defineConfig` is an array, and the config `include`/`ignore` keys become `ignores`.
  4. In detectors, replace `context.flag()` with `context.report()`, and `getFilename()` and `getSourceCode()` with the `absolutePath`, `path`, and `source` properties. `getLinesAround()` is removed.
  5. Rename types: `AgentReviewConfig` → `AgentlintConfig`, `AgentReviewRule` → `AgentlintRule`, `AgentReviewNode` → `AgentlintNode`, `FlagOptions` → `FindingOptions`, `FlagRecord` → `FindingRecord`. `RuleMeta` is removed, and `Position` is exported as a type only.
  6. Update CLI calls: `list` → `rules list`; `review <hash...>`, `review --all`, and `review --reset` → `accept`/`approve` with a reason, or the review UI; `check --dry-run` and the `-a`, `-r`, and `-d` aliases are removed. `--help` is generated for every command, `--rule` can repeat, and usage errors exit `2`.

- [#32](https://github.com/aurelienbobenrieth/agentlint/pull/32) [`52beb9b`](https://github.com/aurelienbobenrieth/agentlint/commit/52beb9bec519baa1c7ccc0a800b8283b37bb09cd) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Make the gate binary: every current finding is accepted or unresolved, with the same semantics locally and in CI.

  - `.agentlint/acceptances.jsonl` is committed and stores only current acceptances, each with a reason and `agent` or `human` authority. An acceptance opens the gate only when the standard revision, detector version, binding digest, versioned fingerprint, and authority all match. Lineage can show a prior reason but never opens the gate.
  - State findings use `source-structure` fingerprints (version 3). They survive formatting-only edits and line moves, and a material change invalidates them. Sources are read with LF line endings, so CRLF and LF checkouts of the same commit agree. Change findings use `git-change` fingerprints (version 2).
  - A complete scan (`check --all`) removes dead acceptances and proposals; a partial scan keeps records it did not examine. Store writes are atomic and guarded by a cross-process lock.
  - Complete scans list files through Git (`git ls-files --cached --others --exclude-standard`), so every machine scans the same files. Outside a Git work tree the directory walk skips only `node_modules` and `.git`. Scope globs match dotfiles. Files whose real path leaves the repository or enters `.git` are never read.
  - A file with incomplete or unsupported syntax fails the run after the rest of the scan instead of being skipped silently.

- [#34](https://github.com/aurelienbobenrieth/agentlint/pull/34) [`d221bc1`](https://github.com/aurelienbobenrieth/agentlint/commit/d221bc11ba048040b289d610abd5bca77805c7b8) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Rework the CLI around the acceptance workflow.

  - `check [files...] [--all] [--base] [--rule] [--format text|jsonl] [--review-output]` runs the gate. Exit `0` means the gate is open, `1` means unresolved findings, and `2` means invalid usage, configuration, evidence, or an internal error. `--format jsonl` writes only finding records to stdout.
  - `next` hands an agent one current obligation as versioned JSON, with the full finding key, evidence, authority, and argument arrays.
  - `accept` records an agent acceptance and `approve` a human one, each with a reason. `propose --summary [--diff-file]` attaches agent work to a finding the agent cannot accept.
  - `explain` shows the standard and guidance behind a rule or finding.
  - `rules list|test|scan [--review]|calibration`, `acceptances list|clean|import`, and `outcomes` manage rules, calibration, acceptances, and delayed outcome records.
  - Git failures explain their fix: a shallow clone, a missing default branch, a base ref starting with `-`, or a missing `git` executable. Change evidence does not depend on the user's diff settings or locale.
  - The config loader resolves `@aurelienbbn/agentlint` and its subpaths to the running copy, so `npx --yes @aurelienbbn/agentlint check` works in a repository that never installed it.

- [#34](https://github.com/aurelienbobenrieth/agentlint/pull/34) [`d221bc1`](https://github.com/aurelienbobenrieth/agentlint/commit/d221bc11ba048040b289d610abd5bca77805c7b8) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Add a reusable GitHub action (`aurelienbobenrieth/agentlint/action`). It runs the gate on pull requests and reports it as a check run, a sticky summary comment, and inline review comments. It records human approvals from `/agentlint approve` comments and uploads a detached review artifact for `agentlint pr`.

  - The token never reaches the install, the CLI, or git hooks.
  - `pull_request_target` is rejected, and markers are trusted only in comments that an application posted.
  - HTTP requests, pagination, subprocesses, and annotations are bounded.
  - `dry-run` prints the planned writes instead of making them.

- [#34](https://github.com/aurelienbobenrieth/agentlint/pull/34) [`d221bc1`](https://github.com/aurelienbobenrieth/agentlint/commit/d221bc11ba048040b289d610abd5bca77805c7b8) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Update the package, its dependencies, and its skills.

  - Depend on Effect `4.0.0-rc.115`. `effect`, `@effect/platform-node`, and `@effect/platform-node-shared` are pinned together so npm and yarn install a single copy.
  - Ship the changelog and third-party notices in the package.
  - Publish through npm trusted publishing from a protected GitHub environment.
  - Add a `setup` skill that installs agentlint in a repository. It covers verified rule-package presets, gradual adoption, and a Claude Code and Codex Stop hook script (`agentlint-gate.mjs`) over the CLI exit code. Update the `usage` and `rule-advisor` skills to the 0.2 model.

- [#32](https://github.com/aurelienbobenrieth/agentlint/pull/32) [`52beb9b`](https://github.com/aurelienbobenrieth/agentlint/commit/52beb9bec519baa1c7ccc0a800b8283b37bb09cd) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Ship a keyboard-first review application inside the package.

  - `agentlint review` serves it on `127.0.0.1` behind a single-use token and a per-port session cookie. The **Queue** lists findings that need a decision, grouped by file, with the agent's proposal, related-file context, and prior lineage next to the evidence. **Decisions** lists what is accepted, by whom and when, and lets a human request a correction. Detected editors open findings at the exact position.
  - `check --review-output` writes a detached artifact that `review --from` opens without a repository. Decisions are exported for `acceptances import`, which is all-or-nothing and rejects a decision whose source differs from what the reviewer saw.
  - `agentlint pr <number>` downloads the review artifact that the GitHub action uploaded, through the `gh` CLI, and opens it only when the run belongs to the pull request's own head repository and branch.
  - `rules scan --review` opens calibration. Exported reports use the `@aurelienbbn/agentlint/calibration` schemas and combine with `rules calibration`.
  - The review wire contract is published as `@aurelienbbn/agentlint/contract`, including `NextResult` and `DetachedDecision`.

- [#32](https://github.com/aurelienbobenrieth/agentlint/pull/32) [`52beb9b`](https://github.com/aurelienbobenrieth/agentlint/commit/52beb9bec519baa1c7ccc0a800b8283b37bb09cd) Thanks [@aurelienbobenrieth](https://github.com/aurelienbobenrieth)! - Define rules as one `defineRule` discriminated union. A rule composes a revisioned `standard`, a versioned `detector`, and a repository-owned `binding` with scope, typed options, declared dependencies, an optional `reviewEpoch`, and `agent` or `human` authority. The core ships no rules or presets.

  - `lifecycle: "state"` judges current source with declarative `pattern` and `query` matches or a synchronous `createOnce` visitor. A placeholder repeated in a pattern must capture the same code, overlapping matches report each node once, and a match only has to compile for one grammar in the binding's scope.
  - `lifecycle: "change"` judges a normalized `ChangeSet` (file status, before and after snapshots, hunks) computed from the merge base of the detected or `--base` ref and the complete working tree, including staged, unstaged, and untracked files. Change detectors report a stable `key`, material `evidence`, and an optional `lineageKey`.
  - Detectors declare `mustReport` and `mustStaySilent` fixtures, run by `agentlint rules test` and by the promise helpers in `@aurelienbbn/agentlint/testing`: `testRuleFixtures`, `testRuleOnSource`, `testRuleOnSources`, `testRuleOnChange`, and `normalizeChangeFixture`. Each helper takes one named-argument object and rejects on detector failure.
  - `defineRule` throws only `RuleDefinitionError` and `defineConfig` only `ConfigError`, each naming the offending field. A detector that returns a promise or breaks the reporting contract fails its rule with a `DetectorContractError` cause. `FingerprintError`, `PatternError`, and `ParserError` are exported, and `ChangeFixtureError` from `/testing`.
  - The public visitor type covers every packaged grammar node, including the JSON document root, and unknown node names are rejected. Packed declarations no longer depend on tree-sitter's internal types, so strict consumers typecheck without `skipLibCheck`.
  - Configs compose with `extends`, and `agentlint init --preset` composes repository-owned plugin presets.

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
