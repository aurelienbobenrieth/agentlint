# AGENTS.md

Stable engineering boundaries for agentlint. See [CONTRIBUTING.md](CONTRIBUTING.md) for development and rule-authoring details.

## Completion

- Run `pnpm check` for merge-ready work: typecheck, oxlint, oxfmt, skill validation, tests, and the dogfood gate.
- Run `pnpm fmt` before committing.
- `pnpm build` creates the CLI, declarations, review UI under `dist/ui`, and grammar WASM under `dist/wasm`.
- Verify the tarball from `pnpm pack` installs and runs in an empty consumer before publishing.

## Product boundaries

- `packages/agentlint` is the only publishable package. It owns the CLI, engine, state/change pipelines, acceptances, and packaged skills.
- `apps/review` is a FoldKit SPA. It owns presentation and browser-local detached decisions. Domain semantics stay in the package.
- The review wire contract lives in `packages/agentlint/src/features/review/contract.ts`; `apps/review/src/types.ts` mirrors it. Change both together.
- Use public package exports. Do not introduce cross-package relative imports.
- Only `packages/agentlint/src/config/env.ts` may touch `process.*`.

## Domain invariants

- One `defineRule` discriminated union represents `state` and `change` rules.
- A rule composes a versioned standard, a versioned detector, and a repository-owned binding.
- Core ships no rules or presets.
- Gate state is binary: a current finding is accepted or unresolved.
- `.agentlint/acceptances.jsonl` stores only current acceptances. Partial scans never remove unexamined records; complete scans may remove stale ones.
- Acceptance requires exact compatible source identity and fingerprint. Lineage is context and never opens a gate.
- Fingerprint schemes and persisted record schemas are versioned. Never change their meaning silently.
- A change rule always evaluates the merge base of an explicit or detected Git base against the complete working tree, including staged, unstaged, and untracked files.

## Effect conventions

- Effect 4 beta is intentionally pinned. Services use `Context.Service`; layers compose in `bin.ts`.
- `web-tree-sitter` stays at 0.25.10 until the packaged grammar WASM set supports the 0.26 ABI.
- Public runtime contracts use Effect Schema where practical.
- Tagged errors expose structured fields and derive `message`; do not add stringly `message: Schema.String` fields.

## References

`.agents/ref-repos/` holds gitignored reference clones. Run `pnpm refs:sync` to create or refresh them. Sources: `effect` (Effect-TS/effect `main`, Effect V4; `effect-smol` is archived), `eslint`, `oxc`, `foldkit`, `t3code`, and `executor`.
