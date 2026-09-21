# Minimal consumer example

This is the smallest useful agentlint project: one dependency, one tested rule, one source file.

```bash
pnpm install          # from the repository root: the example uses the workspace protocol
pnpm --filter ./examples/minimal run rules:test
pnpm --filter ./examples/minimal run check
```

The workspace protocol tests this example against the current package. In a consumer project, install the equivalent public range with `npm install --save-dev @aurelienbbn/agentlint@^0.2.0`.
