# AGENTS.md

Principles and boundaries that stay true while implementations churn. For local
development, rule authoring, and the release flow see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Task Completion

- Full gates for merge-ready work: `pnpm check` (typecheck across all packages,
  oxlint, oxfmt, intent validate, vitest).
- Run the narrowest useful verification for a change: `pnpm --filter
@aurelienbbn/agentlint test` for engine work, `pnpm --filter @agentlint/review
typecheck` for UI work.
- Run `pnpm fmt` before committing; oxfmt owns formatting.
- `pnpm build` produces `packages/agentlint/dist` including the review UI
  (`dist/ui`) and grammar WASM (`dist/wasm`). `pnpm pack` inside
  `packages/agentlint` is the release artifact; verify it installs before
  publishing.

## Package Roles

- `packages/agentlint`: the product. CLI, engine (tree-sitter pipeline, pattern
  matching, ledger, notes), MCP server, harness hook adapters, packaged skills.
  The only publishable package; everything else composes into it.
- `packages/ui` (`@agentlint/ui`): presentational components only. No data
  fetching, no routing, no agentlint domain logic. `src/components/ui/**` are
  vendored COSS UI primitives (lint-excluded; refresh via
  `pnpm dlx shadcn@latest add @coss/<name>` from the package directory, do not
  hand-edit). agentlint composition components live in `src/components/*`.
- `apps/review`: the review SPA. Containers, pages, i18n (Paraglide,
  `messages/{en,fr}.json`). Imports `@agentlint/ui` public exports only — never
  deep paths into the ui package. Builds into
  `packages/agentlint/dist/ui`, served by `agentlint review`.

## Boundaries

- Keep package boundaries clear; use public package exports, not cross-package
  relative imports. The `@ui/*` alias exists for the ui package's internal
  imports, not for consumers.
- `src/config/env.ts` is the only module in `packages/agentlint` that touches
  `process.*`. Everything else depends on the `Env` service.
- The review server wire contract lives in
  `packages/agentlint/src/features/review/contract.ts`;
  `apps/review/src/types.ts` mirrors it. Change both together.
- The ledger (`.agentlint/ledger.jsonl` in consumer repos) is committed,
  append-only project state keyed by finding hashes. Never change hash inputs
  or record shapes without a migration story.

## Effect Conventions

- Effect 4 (beta, pinned). Services via `Context.Service`, layers compose in
  `bin.ts`. Follow `effect-smol` style for services/Schema and JSDoc
  (`@since`/`@category`).
- Tagged errors carry structured fields with namespaced tags
  (`agentlint/LedgerError`) and derive `message` getters from those fields.
  Never define a stringly `message: Schema.String` field on new error types.
- Prefer `Effect Schema` for public data contracts and runtime validation;
  derive types from schemas.

## Reference Repos

`.agents/ref-repos/` holds gitignored clones for patterns: `effect-smol`
(service/Schema style), `executor` and `opencode` (Effect-first product
organization), `plannotator` (review UX), `oxc`/`eslint` (rule conventions).
Pull latest before relying on one.

## Learned Notes

`.agents/learn/` holds rare, expensive debugging knowledge with trigger
frontmatter. Search it with `rg` when a bug looks familiar; add a note only
after non-obvious investigation.
