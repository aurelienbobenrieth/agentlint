# agentlint

[![CI](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml/badge.svg)](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@aurelienbbn/agentlint.svg)](https://www.npmjs.com/package/@aurelienbbn/agentlint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/aurelienbobenrieth/agentlint/blob/main/LICENSE)

**Your `AGENTS.md` rules are followed most of the time. agentlint turns the important ones into a gate and keeps a committed record of every exception.**

Agents get the mechanical part right and slip on judgment: a payment call without an idempotency key, a dropped column without a backfill, a fallback that hides a failure, an unbounded read that was fine in the fixture.

| Tool          | With a judgment call                            |
| ------------- | ----------------------------------------------- |
| Prompt        | Asks the agent to remember                      |
| Linter        | Can only say "always wrong"                     |
| AI reviewer   | Says something different on every run           |
| Tired human   | Approves a big diff because the tests are green |
| **agentlint** | Blocks until someone records a reason           |

## Every finding is accepted or it blocks

```text
 repository ──▶ deterministic ──▶ finding + your ──▶ acceptance with     ──▶ gate open
 evidence        detector          standard           reason + authority
                                        │
                                        └── no compatible acceptance ──────▶ gate closed
```

- **Deterministic.** Rules match a code shape or a normalized Git change. No model, network, or clock.
- **The standard travels with the finding**: text, checks, permitted examples. The agent doesn't rely on recall.
- **Exceptions are reviewable.** An acceptance needs a reason and the right authority (`agent` or `human`, per rule). It lives in `.agentlint/acceptances.jsonl`, shows in the PR diff, and expires when the code materially changes: an `eslint-disable` that needs a reason, an authority, and a new review when the code moves.
- **Humans decide** in a keyboard-first local UI or in PR threads, with code, standard, and the agent's proposal side by side.

> An open gate means every current finding in the reported scan scope has a compatible recorded decision. It does not prove the judgment was correct, or that unconfigured concerns were reviewed.

agentlint ships no rules and prescribes no agent harness. Your repository and plugin packages own the standards, detectors, and policy.

## Install and run the gate

Let your agent do it: the package ships agent skills.

```text
Install @aurelienbbn/agentlint and follow its setup skill
(node_modules/@aurelienbbn/agentlint/skills/agentlint/setup/SKILL.md).
```

Or by hand:

```bash
pnpm add -D @aurelienbbn/agentlint
pnpm agentlint init          # creates .agentlint/config.ts
pnpm agentlint rules test    # replays every rule's fixtures
pnpm agentlint check --all   # the gate
```

Commit the config, and `.agentlint/acceptances.jsonl` once it exists. Every command accepts `--help`.

## A rule is a code shape plus a standard

```ts
import { defineConfig, defineRule } from "@aurelienbbn/agentlint";

const boundedReads = defineRule({
  lifecycle: "state",
  standard: {
    id: "data/bounded-reads",
    revision: 1,
    title: "Production reads are bounded",
    guidance: { standard: "Reads that scale with production data have an explicit bound or pagination contract." },
  },
  detector: {
    id: "prisma/find-many-without-take",
    version: 1,
    match: { pattern: "$DB.findMany($$$ARGS)", where: { notHas: "take: $_" }, message: "$DB has no explicit bound." },
    fixtures: { mustReport: ["db.users.findMany({})"], mustStaySilent: ["db.users.findMany({ take: 50 })"] },
  },
  binding: { id: "data/bounded-reads", authority: "agent", include: ["src/**/*.ts"] },
});

export default defineConfig({ rules: [boundedReads] });
```

The `standard` is revisioned policy, the `detector` a versioned trigger, and the `binding` your scope and authority. A `change` rule judges the Git diff from the merge base instead of the current code.

## Exit codes

| Exit | Meaning                                                   |
| ---- | --------------------------------------------------------- |
| `0`  | Every current finding has a compatible acceptance         |
| `1`  | One or more findings are unresolved                       |
| `2`  | Invalid usage, configuration, or evidence; internal error |

Every command exits `2`, never `1`, on an internal error. Local and CI semantics are identical.

## What do you want to do?

| Goal                                   | Start with                          | Guide                                                                                                  |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Turn a repeated correction into a rule | the `rule-advisor` skill            | [Get started](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/getting-started.md) |
| Write state and change rules           | `defineRule`                        | [Write rules](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/writing-rules.md)   |
| Close a finding                        | `agentlint accept 1 --reason "..."` | [Acceptance](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/acceptance.md)       |
| Hand the agent its next finding        | `agentlint next --format json`      | [Acceptance](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/acceptance.md)       |
| Decide as a human                      | `agentlint review`                  | [Review](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/review.md)               |
| Calibrate a rule before it gates       | `agentlint rules scan --review`     | [Calibration](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/calibration.md)     |
| Gate pull requests and agent turns     | the GitHub action or a `Stop` hook  | [CI and hooks](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/ci.md)             |
| Look up a command or flag              | `agentlint --help`                  | [CLI reference](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/cli.md)           |
| Know what the gate guarantees          |                                     | [Guarantees](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/guarantees.md)       |

The required CI check is the real gate; local hooks are feedback. On GitHub:

```yaml
steps:
  - uses: actions/checkout@v5
    with: { fetch-depth: 0 } # required: change rules use the merge base
  - uses: actions/setup-node@v5
    with: { node-version: 22 }
  - uses: aurelienbobenrieth/agentlint/action@v0.2.0
```

The full workflow is in the [CI guide](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/ci.md).

## Public entry points

| Import                               | Exports                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `@aurelienbbn/agentlint`             | `defineConfig`, `defineRule`, rule and config types, detector contexts, change evidence and outcome schemas, tagged errors |
| `@aurelienbbn/agentlint/testing`     | Promise-based fixture helpers                                                                                              |
| `@aurelienbbn/agentlint/contract`    | Review wire contract, including `NextResult`                                                                               |
| `@aurelienbbn/agentlint/calibration` | Calibration report schemas and pure helpers                                                                                |

Every type, schema, and error: [Public API](https://github.com/aurelienbobenrieth/agentlint/blob/main/docs/guide/api.md).

## License

[MIT](https://github.com/aurelienbobenrieth/agentlint/blob/main/packages/agentlint/LICENSE)
