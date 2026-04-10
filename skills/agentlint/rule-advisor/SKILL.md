---
name: agentlint/rule-advisor
description: >
  Classify a code quality concern into the right enforcement tool and act on it.
  Activate when the user wants to enforce a pattern, catch a mistake, add a
  check, create a rule, prevent a practice, guard against regressions, set up
  linting, improve their feedback loop, or asks "how do I make sure X."
type: core
library: agentlint
library_version: "0.1.4"
sources:
  - "aurelienbobenrieth/agentlint:README.md"
  - "aurelienbobenrieth/agentlint:CONTRIBUTING.md"
---

# Rule Advisor

Classify what the user wants to enforce, pick the right tool, act on it.

## How to use this skill

1. Identify the specific pattern, practice, or constraint to enforce
2. If unclear, clarify with one targeted question
3. Check existing enforcement first: scan the project's lint rules, architecture tests, and agentlint config for overlap before creating anything new
4. Classify using the decision tree below
5. State your classification and reasoning in one sentence
6. For agentlint rules: implement using the template below. For other tools: guide the user to the right one

## Decision tree

**Can a pattern be detected by looking at code structure (AST, file, imports)?**

NO, and no metric or structure can trigger detection either
→ Document as a code review guideline. This is a team convention.

YES, and the correct action is always the same (mechanical fix)
→ Existing linter rule (e.g. oxlint, eslint, biome, or similar)
if a well-known rule exists for it.
→ Custom lint rule (e.g. eslint plugin, or similar)
if it's project-specific but still deterministic.
→ Codemod (e.g. jscodeshift, ts-morph, or similar)
if it needs automated rewriting across files.

YES, but what to do about each finding requires judgment
→ **agentlint rule.** Deterministic detection, AI-evaluated action.

**Is it about module or dependency structure?**
→ Dependency analysis (e.g. dependency-cruiser, madge, or similar)
for import direction and boundaries.
→ CI check or agentlint rule for file/directory naming conventions.

**Is it about runtime behavior?**
→ Type-level enforcement (e.g. branded types, schema validation, or similar)
if it can be caught at compile time.
→ Tests (unit, integration, property-based) if it needs execution.
→ Monitoring if it needs production signals.

## Skills vs rules vs both

Skills and agentlint rules serve different roles. A **skill** teaches
the agent how to approach a domain — patterns, trade-offs, when to use
what. A **rule** scans code after the fact and flags specific instances
for evaluation. They are not mutually exclusive.

**Skill alone** — the concern is about workflow, tooling usage, or
cannot be detected by looking at code structure. Example: "use pnpm
instead of npm" as a team preference, or "how to structure API routes."

**Rule alone** — the pattern is self-contained and the rule's
instruction provides enough context to evaluate each finding. Example:
"flag TODO comments for triage."

**Skill + rule together** — a skill teaches the broader philosophy,
a rule enforces specific instances. The skill shapes how the agent
writes code. The rule catches what slipped through. They reinforce
each other.

Example: a skill explains "use server actions for mutations, not API
routes" with reasoning and patterns. A companion rule scans for API
route files with POST handlers doing database writes, flagging them
for evaluation against the skill's guidance.

Use this pairing when a skill contains statements like "never do X",
"always use Y", or "avoid Z pattern" and the pattern is AST-detectable.

### When to extract rules from skills

Review existing skills for statements like "never do X", "always use Y",
or "avoid Z pattern." If the pattern is AST-detectable, extract it into
an agentlint rule. Keep the skill for the broader guidance and reasoning,
move the specific enforcement to the rule. This gives you:

- **Coverage** — the rule catches every instance, not just when the
  agent happens to recall the skill
- **Auditability** — flagged patterns are visible in agentlint output
- **Separation** — the skill teaches, the rule verifies

## When the answer is agentlint

agentlint's niche: deterministic detection + non-deterministic evaluation.

Three scopes are available:

- **Single-node visitor** - flag individual AST nodes (comments, functions,
  catch blocks, magic numbers)
- **Program visitor** - analyze the full file AST (duplicate function bodies,
  nested loops, export counts, prop counts)
- **File-level targeting** - use include/ignore globs to scope rules to
  specific directories or file patterns

### Rule template

```typescript
import { defineRule } from "@aurelienbbn/agentlint";

const myRule = defineRule({
  meta: {
    name: "rule-name",
    description: "One-line description of what this detects",
    languages: ["ts", "tsx"],
    include: ["src/**"], // optional: scope to paths
    ignore: ["**/*.test.*"], // optional: exclude paths
    instruction: `[Be specific. Tell the AI agent exactly what to evaluate
for each finding, when a finding is acceptable, and what action to take
when it is a true positive.]`,
  },
  createOnce(context) {
    return {
      // Available visitors: program, function_declaration, arrow_function,
      // call_expression, identifier, string, comment, class_declaration,
      // method_definition, property_identifier, type_annotation,
      // interface_declaration, import_statement, export_statement,
      // variable_declarator, if_statement, return_statement,
      // object, array, pair, jsx_element, jsx_self_closing_element
      comment(node) {
        context.flag({ node, message: node.text.trim() });
      },
    };
  },
});
```

### AgentReviewNode API

- `text` - source text of the node
- `type` - tree-sitter node type
- `startPosition` / `endPosition` - `{ row, column }`
- `children` - child nodes array
- `parent` - parent node or undefined
- `child(i)` / `namedChild(i)` - get child by index
- `childForFieldName(name)` - get child by field name
- `descendantsOfType(type)` - find all descendants matching a type

### Writing good instructions

The instruction determines whether findings are actionable or noise.
A good instruction has three parts: what to evaluate, what's acceptable,
and what action to take on true positives.

Bad: "Review this code"

Good: "Evaluate each flagged catch block. If the error is logged and
re-thrown, it is acceptable. If the error is silently swallowed - empty
catch or catch with only a console.log - suggest adding proper error
handling or propagation."

The agent reads only the instruction, not the rule source. If the
instruction is vague, every finding becomes noise. If it over-specifies,
acceptable patterns get flagged as issues.

### Testing

```bash
pnpm agentlint check --all --rule rule-name
pnpm agentlint check src/handlers/checkout.ts --rule rule-name
pnpm agentlint check --all --rule rule-name --dry-run
```
