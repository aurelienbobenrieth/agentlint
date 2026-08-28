# agentlint

[![CI](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml/badge.svg)](https://github.com/aurelienbobenrieth/agentlint/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@aurelienbbn/agentlint.svg)](https://www.npmjs.com/package/@aurelienbbn/agentlint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Deterministic findings and explicit judgment gates for coding agents.

Linters reject code that is mechanically wrong. Prompts ask agents to remember concerns. agentlint covers the space between them: it deterministically finds places that require judgment, gives the reviewer the applicable standard, and keeps the gate closed until the evidence changes or someone records an acceptance with enough authority.

agentlint does not call a model, ship product rules, or prescribe an agent harness.

```bash
pnpm add -D @aurelienbbn/agentlint
pnpm agentlint init
pnpm agentlint rules test
pnpm agentlint check --all
```

Read the [package guide](packages/agentlint/README.md), try the [product demo](DEMO.md), or start with the [0.2 decisions](docs/decisions/README.md).

## Workspace

- `packages/agentlint` — publishable CLI, engine, rule API, and packaged review application.
- `apps/review` — FoldKit single-page review application compiled into the package.
- `examples/demo` — state and change rules exercised as a consumer would use them.

## License

[MIT](LICENSE)
