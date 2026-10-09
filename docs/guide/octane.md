# Scan authored Octane state

Octane `.tsrx` state scanning is optional. Install the tested compiler in the consumer project and opt in:

```sh
npm install --save-dev --save-exact octane@0.10.0
```

```ts
import { defineConfig } from "@aurelienbbn/agentlint";
import { workspaceRule } from "./rules.js";

export default defineConfig({ tsrx: "octane", rules: [workspaceRule] });
```

The runtime resolves `octane/compiler/volar` from the repository root. The package has an optional peer, so plain TS, TSX, JS, and JSON consumers do not need Octane. A state binding that includes a `.tsrx` file must opt in. Without the compiler or opt-in, the scan exits 2 instead of silently excluding that file. Git change rules remain independent of the frontend.

## What rules inspect

Agentlint calls Octane's official `compileToVolarMappings` with `loose: false`, rejects reported errors, and validates the complete authored `sourceAst` ranges and checks that program, template, and statement-block gaps contain no omitted code. It does not scan generated code or use generated source-map offsets. Positions use the authored UTF-16 offsets, paths retain `.tsrx`, and review handoffs contain the complete authored source.

The adapter builds a tree from maximal unchanged authored TS/TSX regions. These regions use the existing TSX grammar and matcher. Components and template control flow use explicit boundary nodes instead of pretending that generated helpers are authored calls:

| Authored construct                               | Boundary visitor                            |
| ------------------------------------------------ | ------------------------------------------- |
| Component declaration containing `@{`            | `octane_function_declaration`               |
| Component body                                   | `octane_jsx_code_block`                     |
| `@if`, including `@else` branches                | `octane_jsx_if_expression`                  |
| `@for`, including keyed loops                    | `octane_jsx_for_expression`                 |
| Template branch/loop block                       | `octane_block_statement`                    |
| Fragment or element containing template controls | `octane_jsx_fragment`, `octane_jsx_element` |

Other ancestors spanning boundaries have `octane_` plus the authored compiler kind in snake case, such as `octane_export_named_declaration`. Their field names come from the compiler, such as `declaration`, `params`, `body`, `render`, `test`, `consequent`, `alternate`, `left`, `right`, and `key`. Arrays remain source-ordered children, and `childByFieldName` returns the first child for an array field. Ordinary regions retain tree-sitter fields and node types. Visitors can traverse the authored parent/child tree. Comments in boundary gaps contribute evidence but are not separate visited comment nodes.

For example, `useLinkedState(query, $INITIAL)` inspects the unchanged call and callback, including TypeScript annotations. It cannot match a compiler-created `__map_iterable` call because that generated code never enters the scan. To inspect a component or an Octane branch, use a boundary visitor and its authored fields.

Tree-sitter queries execute within each unchanged region. A query cannot describe relationships across Octane boundaries. Queries whose matches depend on temporary parse-context wrappers fail with an actionable error. This includes whole-program queries and an expression-statement query applied to a condition parsed in isolation. Narrow queries and test both activation and silence on real `.tsrx` fixtures. The adapter is a structural frontend, not a type checker or an Octane runtime verifier.

## Test the detector

CLI fixtures use the config's opt-in:

```sh
agentlint rules test
agentlint check --all --format jsonl
agentlint next --format json
```

Use authored fixture filenames and opt in through the public testing API:

```ts
import { testRuleFixtures, testRuleOnSource } from "@aurelienbbn/agentlint/testing";

await testRuleFixtures(workspaceRule, { tsrx: "octane" });
await testRuleOnSource({
  rule: workspaceRule,
  file: "Card.tsrx",
  source: 'export function Card() @{ const state = useLinkedState(query, () => ""); <div>{state}</div> }',
  tsrx: "octane",
});
```

`testRuleOnSources` accepts the same `tsrx` option. Resolve the compiler from the test process's working directory, just as the CLI does from the repository root.

## Evidence and refusal

Findings use the existing `source-structure` v4 identities and acceptance store. The complete authored tree and punctuation gaps contribute evidence. Compiler metadata and locations do not. Whitespace in boundary punctuation is normalized, ordinary regions retain the existing formatting normalization, and JSX text uses the existing JSX whitespace rules. Newlines and indentation retain acceptance in the tested cases. Changed authored identifiers, literals, operators, template text, or loop keys invalidate the complete file evidence. No parser failure returns a partial finding set or reconciles acceptance as a clean scan.

Supported and tested syntax includes imports, typed component parameters, ordinary and typed arrow callbacks, template expressions, sibling conditionals and loops inside a fragment, `@else` branches, keyed loops, and the frozen workspace-search component. Malformed calls and multiple top-level template outputs are refused. Scoped styles, `@switch`, `@try`, and JSX spread children are currently refused rather than treated as complete coverage. Other unsupported ordinary regions also fail closed. This is not a qualification of the complete Octane grammar or every formatter transformation.

The tested compiler is exactly Octane **0.10.0**. Other versions are refused until qualified. Its Volar entry uses its bundled JavaScript frontend with TypeScript compatibility parsing. The installed dependency includes `@tsrx/oxc` **0.16.0**, but this scan does not claim to exercise that native parser. Engine tests use Effect **4.0.0**, TypeScript **7.0.2**, web-tree-sitter **0.25.10**, and tree-sitter-typescript **0.23.2** for TSX. Consumer CLI proof ran on Node **24.16.0**. The optional compiler requires Node **22.22.2** or newer. Octane declares a TypeScript 5.9 peer, so consumer projects should retain their own supported toolchain. The scanner calls the compiler API, not its TypeScript integration.

Missing compiler exports, compiler exceptions, reported syntax errors, invalid/overlapping ranges, a partial program range, or an unrepresentable region produce `ParserError` with `frontend_failed`. `accept` reparses current evidence and cannot accept those failed scans. The compiler is executable consumer-installed code, so opting in trusts that dependency just as loading a rule config trusts its code.

The existing source-pattern matcher still ignores some anonymous operator tokens. A pattern containing `===` can match `<=`. This change retains regression evidence for TSX and TSRX, and verifies an explicit operator-constrained tree-sitter query as the alternative. It does not change the general matcher.

## Reproduce package proof

From the maintainer checkout:

```sh
pnpm check
pnpm --filter @aurelienbbn/agentlint pack --pack-destination /tmp
node scripts/smoke-package.mjs /tmp/aurelienbbn-agentlint-0.7.0.tgz
node scripts/smoke-octane.mjs /tmp/aurelienbbn-agentlint-0.7.0.tgz /absolute/path/to/fresh-proof-directory
```

The Octane smoke script installs the tarball in its own consumer project. It first proves that plain installation omits Octane, then proves compiler setup, actual CLI fixtures, repeated before/after scanning, original positions and source, formatting compatibility, material invalidation, fail-closed checks, and the installed public testing route. It retains exact commands, outputs, source/compiler/tarball hashes, and the consumer dependency lockfile. It does not configure any other repository or publish a package.
