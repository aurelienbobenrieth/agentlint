# agentlint

[![CI](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml/badge.svg)](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@aurelienbbn/agentlint.svg)](https://www.npmjs.com/package/@aurelienbbn/agentlint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Deterministic triggers for contextual agent guidance and accountable resolution.

Classic linters handle mechanical violations with one correct fix. Skills and prompts activate probabilistically. agentlint covers the gap between them: **deterministic activation, judgment-based resolution, accountable ledger**.

Full documentation lives in the package README: **[packages/agentlint](packages/agentlint/README.md)**.

```bash
pnpm add -D @aurelienbbn/agentlint
pnpm agentlint init
```

## Workspace

| Path                                     | Role                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [packages/agentlint](packages/agentlint) | The product: CLI, engine, MCP server, harness hooks, packaged skills. Publishable.                                           |
| [apps/review](apps/review)               | Local review SPA served by `agentlint review` (Vite, TanStack Router/Query, Paraglide). Builds into the product's `dist/ui`. |
| [packages/ui](packages/ui)               | `@agentlint/ui`: presentational component library (COSS UI primitives + agentlint composition components).                   |

See [AGENTS.md](AGENTS.md) for package roles and boundaries, and [CONTRIBUTING.md](CONTRIBUTING.md) for local development and rule authoring.

## License

[MIT](LICENSE)
