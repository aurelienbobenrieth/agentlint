# Minimal consumer example

This is the smallest useful agentlint project: one dependency, one tested rule, one source file.

```bash
npm install
npm run rules:test
npm run check
```

The workspace protocol tests this example against the current package. In a consumer project, install the equivalent public range with `npm install --save-dev @aurelienbbn/agentlint@^0.2.0`.
