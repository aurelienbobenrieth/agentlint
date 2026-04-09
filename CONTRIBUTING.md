# Contributing

## How to contribute

- [Open an issue](https://github.com/aurelienbobenrieth/agentlint/issues) to report bugs or request rules.
- [Start a discussion](https://github.com/aurelienbobenrieth/agentlint/discussions) for broader ideas, questions, or feedback.

## Local development

- Node 22+, pnpm 10+
- `pnpm install`
- `pnpm check` runs the full validation suite (typecheck, lint, format check, test)

```bash
pnpm typecheck    # Type check
pnpm test         # Run tests
pnpm test:watch   # Run tests in watch mode
pnpm lint         # Lint with oxlint
pnpm fmt          # Format with oxfmt
pnpm build        # Build with tsdown
pnpm check        # Run all checks
```

## Writing a rule

Rules use `defineRule()` with metadata and a visitor factory:

```typescript
import { defineRule } from "agentlint";

export const myRule = defineRule({
  meta: {
    name: "my-rule",
    description: "What it checks",
    languages: ["ts", "tsx"],
    instruction: "How the AI should evaluate matches",
  },
  createOnce(context) {
    return {
      // Optional: per-file setup. Return false to skip.
      before(filename) {},

      // Visitor for specific AST node types (tree-sitter names)
      function_declaration(node) {
        context.flag({
          node,
          message: "Something suspicious",
        });
      },

      // Optional: aggregate analysis after all files
      after() {},
    };
  },
});
```

### Available visitor keys

Any tree-sitter node type string is a valid visitor key. Common ones:

- `comment` - all comments
- `function_declaration`, `arrow_function`, `method_definition`
- `class_declaration`
- `call_expression`, `new_expression`
- `import_statement`, `export_statement`
- `if_statement`, `try_statement`, `return_statement`
- `jsx_element`, `jsx_self_closing_element`
- `type_alias_declaration`, `interface_declaration`

### The AgentReviewNode API

```typescript
node.type; // tree-sitter node type string
node.text; // full source text
node.startPosition; // { row, column } (0-indexed)
node.endPosition; // { row, column } (0-indexed)
node.children; // child nodes (lazily wrapped)
node.parent; // parent node or null
node.childCount; // number of children

node.childByFieldName("name"); // grammar field access
node.childrenByType("comment"); // direct children of type
node.descendantsOfType("string"); // recursive search
```

## Testing rules

Tests use real tree-sitter WASM parsing. See `test/services/TreeWalker.test.ts` for examples.

## Commits

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
