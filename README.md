# agentlint

[![CI](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml/badge.svg)](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@aurelienbbn/agentlint.svg)](https://www.npmjs.com/package/@aurelienbbn/agentlint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Deterministic findings and explicit judgment gates for coding agents.**

Your `AGENTS.md` rules are followed most of the time, AI reviewers say something different on every run, and large diffs get approved because the tests are green. Linters reject code that is mechanically wrong; prompts only ask agents to remember. agentlint covers the space between them: it deterministically finds the places that need judgment, gives the reviewer the applicable standard, and keeps the gate closed until the evidence changes or someone with enough authority records an acceptance. Every exception is a committed, reviewable record: an `eslint-disable` that needs a reason, an authority, and a new review when the code moves.

```text
repository evidence -> deterministic detector -> finding
finding + exact compatible acceptance      -> gate open
finding without acceptance                 -> gate closed
```

agentlint calls no model, ships no rules, and prescribes no agent harness. Your repository owns every standard.

## Why

An agent that touches a payment call, drops a column, or widens a permission usually does the mechanical part right. The part that goes wrong is the judgment: _is this retry safe, is this migration reversible, should a human see this?_ A linter cannot answer that. A prompt cannot guarantee the agent asked. agentlint turns the question into a deterministic trigger with a written standard and an explicit answer that survives in Git.

- **State rules** judge current source: `db.users.findMany()` without a bound, a tagged error with a stringly message.
- **Change rules** judge the Git change itself: a dropped table between the merge base and the working tree, a widened role.
- **Authority** decides who may close the gate. An agent can accept a bounded query with a concrete reason. Only a human can accept a destructive migration.
- **Fingerprints** keep an acceptance across formatting and line moves and invalidate it when the code materially changes.
- **Review epochs** let a repository deliberately expire otherwise compatible decisions without making the engine depend on a clock.
- **Outcomes** attach later corrections, rollbacks, incidents, useful interceptions, and unnecessary reviews to the finding that prompted the decision.

## Quick start

```bash
pnpm add -D @aurelienbbn/agentlint
pnpm agentlint init          # creates .agentlint/config.ts
pnpm agentlint rules test    # proves each detector against its fixtures
pnpm agentlint check --all   # runs the gate
```

Or tell your coding agent to install the package and follow its `setup` skill: it suggests rules for your stack, calibrates before enforcing, and installs the Claude Code or Codex hook so a finished turn means an open gate.

A rule is one `defineRule` value:

```ts
import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const boundedReads = defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-reads",
    revision: 1,
    title: "Production reads are bounded",
    guidance: "Reads that scale with production data have an explicit bound or pagination contract.",
  },
  detector: {
    id: "prisma/find-many-without-take",
    version: 1,
    match: { pattern: "$DB.findMany($$$ARGS)", where: { notHas: "take: $_" }, message: "$DB has no bound." },
    fixtures: { mustReport: ["db.users.findMany({})"], mustStaySilent: ["db.users.findMany({ take: 50 })"] },
  },
  binding: { id: "data/bounded-reads", authority: "agent", include: ["src/**/*.ts"] },
});

export default defineConfig({ rules: [boundedReads] });
```

When the gate closes, the agent reads the standard, fixes the evidence or records a reason:

```bash
pnpm agentlint explain 1
pnpm agentlint accept 1 --reason "The route caps every request at 100 rows."
```

For findings that need a human, `pnpm agentlint review` opens a local, keyboard-first review workspace with the code, the standard, and the agent's proposal side by side. The [GitHub action](action/README.md) brings the same review to the pull request: one thread per finding, and `/agentlint approve` to record human authority in place.

Read the [package guide](packages/agentlint/README.md) for the full model, walk through the [demo](examples/demo/README.md), or start with the [decision records](docs/decisions/README.md).

## Workspace

| Path                 | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `packages/agentlint` | The published package: CLI, engine, rule API, packaged review UI, skills. |
| `apps/review`        | FoldKit single-page review application, built into the package.           |
| `examples/demo`      | A small commerce app with six rules that exercise every part of the loop. |
| `examples/minimal`   | The smallest consumer: one dependency, one rule, one source file.         |
| `docs/decisions`     | Product and architecture decision records.                                |
| `action`             | Reusable GitHub action: check run, review threads, `/agentlint approve`.  |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Agents working on this repository read [`AGENTS.md`](AGENTS.md) first.

## License

[MIT](LICENSE)
