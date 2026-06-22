# Contributing

## Local Development

- Node 22+ and pnpm 10+
- `pnpm install`
- `pnpm check` runs typecheck, lint, format check, intent validation, and tests
- `pnpm build` builds the package with tsdown

```bash
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm test
pnpm build
pnpm check
```

The repo uses `@effect/language-service` through `tsconfig.json`. Configure your editor to use the workspace TypeScript version so Effect diagnostics are active.

## Engineering Expectations

- Prefer Effect Schema for public data contracts and runtime validation.
- Prefer Effect services/layers for shared infrastructure.
- Derive TypeScript types from schemas where practical.
- Keep rule, parser, CLI, and ledger changes covered by typecheck and tests.
- Inspect relevant local references under `.agents/ref-repos/` before architectural changes:
  - `effect-smol` for Effect service and Schema style
  - `oxc` for visitor lifecycle and config-owned routing
  - `eslint` for rule and preset conventions
  - `skills` for packaged skill shape

## Writing Rules

Rules use `defineRule()` with `id`, `description`, `guidance`, and `createOnce`. Config and presets own file routing and persistence policy.

```ts
import { defineRule } from "@aurelienbbn/agentlint";

export const myRule = defineRule({
  id: "domain/my-rule",
  description: "Flags code that needs a judgment call.",
  guidance: {
    standard: "State the expected standard assertively.",
    checks: ["Name the sub-condition agents commonly miss."],
  },
  createOnce(context) {
    return {
      before(filename) {
        return !filename.endsWith(".generated.ts");
      },
      call_expression(node) {
        context.report({
          node,
          message: "Explain the concrete local concern.",
        });
      },
      after() {},
    };
  },
});
```

Lifecycle:

- `createOnce(context)` runs once per rule run.
- `before(filename)` runs before each matching file and may return `false`.
- Visitor handlers record findings with `context.report`.
- `after()` runs after traversal and can emit aggregate findings.
- Broad routing belongs in config `files`, `ignores`, and `overrides`.

## AgentlintNode API

```ts
node.type;
node.text;
node.startPosition; // { row, column }, zero-indexed
node.endPosition;
node.children;
node.parent;
node.childCount;

node.childByFieldName("name");
node.childrenByType("comment");
node.descendantsOfType("string");
```

Any tree-sitter node type string is a valid visitor key. Common examples include `comment`, `function_declaration`, `call_expression`, `import_statement`, `if_statement`, `try_statement`, `jsx_element`, and `type_alias_declaration`.

## Testing

Use real tree-sitter parsing for pipeline behavior and focused service doubles for command handlers. Cover:

- hash stability for same-file line shifts
- override enable/disable behavior
- ledger read/write validation
- local versus CI disposition gating
- JSONL output shape when changing reporter fields

## Changesets

Add a changeset for user-visible CLI, API, config, output, ledger, dependency, or packaged-skill changes:

```bash
pnpm changeset
```

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
