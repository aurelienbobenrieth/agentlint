# agentlint

agentlint is a deterministic review gate. Read [`packages/agentlint/README.md`](packages/agentlint/README.md) for the product, [`docs/decisions/`](docs/decisions/README.md) for its design, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for maintainer commands.

## Skills

Maintainer skills live in `.agents/skills/` (local, from Harness). When present, read `.agents/skills/communication/SKILL.md` before your first reply; it governs all prose. Load the matching skill before acting:

```text
open requirements, ambiguous domain terms   → align
feature, fix, refactor, new module/export   → build (with testing)
writing or judging tests                    → testing
commit, history, push, PR                   → git
review a change                             → code-review
same correction twice, recurring friction   → retrospect
reusable script, CLI, scaffold, doctor      → toolsmith
writing or improving a skill                → skill-writing
```

## Invariants

1. The same repository state produces the same findings. The engine uses no model, network, or clock.
2. Standards, detectors, and bindings belong to the consumer. Core ships the rule API and engine, never default or recommended rules.
3. The gate is binary: every current finding is accepted or unresolved, with identical local and CI semantics.
4. An acceptance opens a gate only when its standard revision, detector version, binding digest, fingerprint, and authority match exactly. Lineage is context only.

## Boundaries

- Keep the review wire contract in `packages/agentlint/src/features/review/contract.ts`, browser-safe and dependent only on `effect`. Update both server and SPA when it changes.
- Only `packages/agentlint/src/config/env.ts` touches `process.*`; other package code uses the `Env` service.
- Use public package exports between workspaces. Keep public and persisted contracts in Effect Schema, and version persisted schemas and fingerprint schemes.
- Tagged errors carry structured fields and derive `message`.
- Pin `effect` and every `@effect/*` package to the same exact release: the one `foldkit` names as its peer. Keep `web-tree-sitter` at 0.25.10 until the packaged WASM grammars support the 0.26 ABI.
- Treat fingerprint, acceptance, and cleanup changes as gate-critical: add tests and a changeset.

## Before completion

- Run `pnpm check`.
- Add a changeset for user-visible API, CLI, persistence, dependency, or packaged-skill changes.
- Run the packed-package smoke test after dependency, build, or CLI-entry changes.
- Keep the change to the smallest model that makes the correct behavior unsurprising.
