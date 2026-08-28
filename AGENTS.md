# agentlint

agentlint finds the places in a repository that need judgment, hands the reviewer the applicable standard, and keeps a gate closed until the evidence changes or someone with enough authority records an acceptance. It calls no model, ships no rules, and prescribes no harness. Read [`packages/agentlint/README.md`](packages/agentlint/README.md) for the product and [`docs/decisions/`](docs/decisions/README.md) for why it is shaped this way.

This file is for the agent changing agentlint. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the setup and the commands.

## What we never compromise on

1. **Deterministic.** The same repository state produces the same findings. No model, no network, no clock in the engine. If a detector needs judgment, that judgment is the human's or the agent's, recorded as an acceptance, never guessed by the tool.
2. **Repository-owned.** Every standard, detector, and binding lives in the consumer's `.agentlint/config.ts` or in a package they chose. The core exports the rule API and the engine, nothing else. Do not add a preset, a "recommended" rule, or a default detector.
3. **Binary gate.** A current finding is accepted or unresolved. There is no warning level, no severity, no snooze, no CI-only mode. `check` has the same semantics on a laptop and in CI.
4. **Exact acceptance.** An acceptance opens a gate only when standard revision, detector version, binding digest, versioned fingerprint, and authority all match. Lineage can show a previous reason but never opens a gate. Treat fingerprint, acceptance, and cleanup code as gate-critical: change it with tests and a changeset.

## Glossary

- **standard**: the durable review question, with an `id` and a `revision`.
- **detector**: the executable trigger, with an `id` and a `version`. `state` detectors read parsed source. `change` detectors read a normalized Git change set.
- **binding**: the repository's use of a standard and a detector: scope, options, and `agent` or `human` authority.
- **finding**: one place where a binding fired, identified by a versioned fingerprint.
- **acceptance**: the recorded decision that a finding satisfies its standard. Stored in `.agentlint/acceptances.jsonl`, current state only.
- **proposal**: agent work attached to a finding it cannot accept. Stored in `.agentlint/proposals.jsonl`, context only.
- **attached / detached review**: the review SPA writing to the repository through the local server, or working from a portable artifact and exporting decisions.

## Layout

- `packages/agentlint` — the only published package. `src/domain` holds the rule, config, finding, fingerprint, and acceptance contracts. `src/features/<name>/{request,handler}.ts` holds one application command each. `src/shared/pipeline` parses and matches. `src/shared/infrastructure` wraps Git, the filesystem, tree-sitter, and the stores. `src/bin.ts` composes the layers and parses the CLI. `skills/` ships the agent skills.
- `apps/review` — the FoldKit SPA, built into `packages/agentlint/dist/ui`. It owns presentation and browser-local detached decisions. Domain semantics stay in the package.
- `examples/demo` — the walkthrough repository. `examples/minimal` — the smallest consumer.
- `.agentlint/config.ts` — this repository's own rules. `pnpm check` ends by running them.

## Boundaries

- The review wire contract is `packages/agentlint/src/features/review/contract.ts`: Effect Schemas over plain JSON, published as the `@aurelienbbn/agentlint/contract` subpath. `apps/review` imports it from there (the `source` export condition resolves to the TypeScript file in the workspace) and decodes every server response with it. The contract imports nothing but `effect`; keep it browser-safe.
- Only `packages/agentlint/src/config/env.ts` touches `process.*`. Everything else depends on the `Env` service. A repository rule enforces this.
- Use public package exports between workspaces. No cross-package relative imports.
- Tagged errors carry structured fields and derive `message`. No `message: Schema.String` fields. A repository rule enforces this.
- Public runtime contracts and persisted records use Effect Schema. Persisted schemas and fingerprint schemes are versioned. Never change their meaning without bumping the version.

## Dependencies

- Effect 4 is pinned on a prerelease. Every Effect package the CLI resolves (`effect`, `@effect/platform-node`, `@effect/platform-node-shared`) is pinned to the same exact version through the `catalog` in `pnpm-workspace.yaml`. A caret range on a transitive package can pull a newer prerelease and load two Effect runtimes, which crashes consumers at startup. `scripts/smoke-package.mjs` catches this. Bump all of them together.
- `web-tree-sitter` stays at 0.25.10 until the packaged grammar WASM set supports the 0.26 ABI.
- `effect` is a normal dependency, not a peer and not bundled. Consumers write rules against `@aurelienbbn/agentlint` only and never import `effect` themselves.

## Before you say it is done

- `pnpm check` is green: typecheck, oxlint, oxfmt, skill validation, tests, then this repository's own gate.
- A user-visible change has a changeset in `.changeset/`. Public API, CLI, persisted data, dependency, and packaged-skill changes count.
- A change to the review contract updated both sides. A change to a skill kept it short and validated.
- You did not widen scope. Fight for the smallest model that makes the correct behavior unsurprising.

## References

`.agents/ref-repos/` holds gitignored reference clones. Run `pnpm refs:sync` to create or refresh them. Sources: `effect` (Effect-TS/effect `main`, Effect V4), `eslint`, `oxc`, `foldkit`, `t3code`, and `executor`.
