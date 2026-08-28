# Contributing

Thanks for helping. agentlint is small on purpose. Read [`AGENTS.md`](AGENTS.md) for the boundaries we hold and [`docs/decisions/`](docs/decisions/README.md) for the reasons behind them.

## Setup

Node 22.19+ and pnpm 10+. The repository declares its package manager, so Corepack picks the right pnpm.

```bash
pnpm install
pnpm build      # CLI, declarations, review UI (dist/ui), grammar WASM (dist/wasm)
pnpm check      # typecheck, oxlint, oxfmt, skill validation, tests, dogfood gate
```

Other useful commands:

```bash
pnpm test:watch                      # package tests in watch mode
pnpm --filter @agentlint/review dev  # review SPA against a running `agentlint review --port 4973`
pnpm fmt                             # format everything
pnpm refs:sync                       # refresh the reference clones under .agents/ref-repos
```

Configure your editor to use the workspace TypeScript so the Effect language service plugin loads.

## Making a change

1. Keep parsing, Git evidence, persistence, application handlers, CLI formatting, and the browser UI separate. A feature lives in `packages/agentlint/src/features/<name>/` as a `request.ts` and a `handler.ts`.
2. Prefer Effect services for infrastructure and Effect Schema for anything public or persisted.
3. Product rules belong in consumer repositories or rule packages, never in the core.
4. Acceptance compatibility is gate-critical. Changes to source identity, fingerprints, authority, lineage, or cleanup need tests.
5. Add a changeset (`pnpm changeset`) for anything a user can notice: public API, CLI, persisted data, dependencies, packaged skills. Use conventional commit prefixes.
6. Run `pnpm fmt` and `pnpm check` before opening the pull request.

## Verifying the package

CI packs the tarball and installs it in an empty project. Do the same locally when you touch dependencies, the build, or the CLI entry:

```bash
pnpm --filter @aurelienbbn/agentlint pack --pack-destination /tmp
node scripts/smoke-package.mjs /tmp/aurelienbbn-agentlint-*.tgz
```

## Releasing

`release.yml` turns pending changesets into a version pull request. Merging it bumps the package and the skill frontmatter (`scripts/version.sh`). Pushing the matching `v*.*.*` tag runs `publish.yml`, which rebuilds, checks, smoke-tests, and publishes with provenance.

## Writing rules

The package README covers the rule API. In short: one `defineRule` value composes a revisioned `standard`, a versioned `detector`, and a repository `binding`. Fixtures are proof samples, not a catalogue of mistakes. Run `agentlint rules test` and calibrate with `agentlint rules scan --review` before enabling a binding.
