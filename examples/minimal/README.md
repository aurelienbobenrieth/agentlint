# Minimal consumer example

The smallest useful agentlint project:

```text
examples/minimal/
├── package.json            one devDependency: @aurelienbbn/agentlint
├── .agentlint/config.ts    one tested rule
└── src/index.ts            one source file
```

```bash
pnpm install          # from the repository root: the example uses the workspace protocol
pnpm --filter ./examples/minimal run rules:test
pnpm --filter ./examples/minimal run check
```

The workspace protocol tests this example against the current package. In your own project, install the equivalent public range: `npm install --save-dev @aurelienbbn/agentlint@^0.2.0`.
