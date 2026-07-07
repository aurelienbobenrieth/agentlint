import { boundedQuery, defineConfig, defineRule, queryStateCoverage } from "@aurelienbbn/agentlint";

/**
 * Demo configuration - a tour of the rule surface:
 *
 * - `danger/lossy-migration`: pattern match, human-gated, durable.
 * - `security/no-eval`: raw tree-sitter query, durable.
 * - `http/fetch-needs-timeout`: pattern + `where.notHas` constraint.
 * - `tests/no-focused-tests`: plain patterns over test files.
 * - `docs/todo-needs-owner`: `createOnce` escape hatch (comment scanning).
 * - `data/bounded-query`, `ui/query-state-coverage`: shipped rules, routed
 *   off test files through `overrides`.
 */

const lossyMigration = defineRule({
  id: "danger/lossy-migration",
  description: "Flags schema operations that can destroy data.",
  guidance: {
    standard: "Destructive schema operations require an explicit human sign-off.",
    checks: [
      "Dropping tables or columns must be intentional, and reversible or backed up.",
      "Renames disguised as drop-and-recreate count as destructive.",
    ],
    examples: [
      {
        label: "Migrate then drop",
        bad: 'db.dropTable("users_old"); // data not verified copied',
        good: 'await verifyBackfill("users_v2"); db.dropTable("users_old");',
      },
    ],
  },
  match: [
    {
      pattern: "$DB.dropTable($$$ARGS)",
      message: "dropTable on $DB destroys data and needs human approval.",
    },
    {
      pattern: "$DB.dropColumn($$$ARGS)",
      message: "dropColumn on $DB destroys data and needs human approval.",
    },
  ],
  fixtures: {
    invalid: ["db.dropTable('users');", "db.dropColumn('users', 'legacy_flag');"],
    valid: ["db.createTable('users');", "db.renameColumn('users', 'a', 'b');"],
  },
});

const noEval = defineRule({
  id: "security/no-eval",
  description: "Flags dynamic code evaluation.",
  guidance: {
    standard: "Dynamic evaluation of strings as code is a code-injection surface and defeats static analysis.",
    checks: [
      "Prefer a parser, a lookup table, or JSON.parse with a schema.",
      "Vendored code that cannot be edited can be recorded as no-fix with a replacement plan.",
    ],
  },
  match: [
    {
      // Raw tree-sitter query: grammar-level precision when a code-shaped
      // pattern cannot express the constraint.
      query: '(call_expression function: (identifier) @fn (#eq? @fn "eval")) @match',
      message: "eval() executes arbitrary strings as code.",
    },
  ],
  fixtures: {
    file: "fixture.js",
    invalid: ["const result = eval(userInput);"],
    valid: ["const result = evaluate(userInput);", "const s = 'eval(x) in a string';"],
  },
});

const fetchNeedsTimeout = defineRule({
  id: "http/fetch-needs-timeout",
  description: "Flags fetch calls without an abort signal or timeout.",
  guidance: {
    standard:
      "Network calls should carry an AbortSignal (or an equivalent timeout) so a slow upstream cannot hang the caller.",
    checks: [
      "AbortSignal.timeout(ms) or a passed-through signal satisfies the standard.",
      "Fire-and-forget calls where hanging is acceptable can be accepted with a reason.",
    ],
    examples: [
      {
        label: "Bounded fetch",
        bad: "await fetch(url);",
        good: "await fetch(url, { signal: AbortSignal.timeout(5000) });",
      },
    ],
  },
  match: [
    {
      pattern: "fetch($$$ARGS)",
      where: { notHas: "signal" },
      message: "fetch call has no abort signal or timeout.",
    },
  ],
  fixtures: {
    invalid: ["await fetch('/api/users');"],
    valid: [
      "await fetch('/api/users', { signal: AbortSignal.timeout(5000) });",
      "await fetch('/api/users', { signal });",
    ],
  },
});

const noFocusedTests = defineRule({
  id: "tests/no-focused-tests",
  description: "Flags focused tests that silently skip the rest of the suite.",
  guidance: {
    standard: "Focused tests (.only) must not land on main - they disable every other test in the file.",
    checks: ["Remove .only before merging; keep it only in local debugging sessions."],
  },
  match: ["it", "describe", "test"].map((fn) => ({
    pattern: `${fn}.only($$$ARGS)`,
    message: `${fn}.only skips the rest of the suite.`,
  })),
  fixtures: {
    invalid: ["it.only('works', () => {});", "describe.only('suite', () => {});"],
    valid: ["it('works', () => {});", "it.skip('flaky', () => {});"],
  },
});

const todoNeedsOwner = defineRule({
  id: "docs/todo-needs-owner",
  description: "Flags TODO/FIXME comments without an owner or ticket.",
  guidance: {
    standard: "TODOs need an owner or a ticket so they are debt, not folklore.",
    checks: [
      "TODO(name) or TODO(TICKET-123) satisfies the standard.",
      "A TODO that is really a design note should become one.",
    ],
  },
  // createOnce escape hatch: comments are not expressions, so a code-shaped
  // pattern cannot match inside their text.
  createOnce(context) {
    return {
      comment(node) {
        const marker = node.text.match(/\b(TODO|FIXME)\b/);
        if (!marker) return;
        if (/\b(?:TODO|FIXME)\s*\(([^)]+)\)/.test(node.text)) return;
        context.report({ node, message: `${marker[1]} without an owner or ticket.` });
      },
    };
  },
  fixtures: {
    invalid: ["// TODO: paginate this list"],
    valid: ["// TODO(aurel): paginate this list", "// plain comment"],
  },
});

export default defineConfig({
  rules: {
    "data/bounded-query": boundedQuery,
    "ui/query-state-coverage": queryStateCoverage,
    "danger/lossy-migration": lossyMigration,
    "security/no-eval": noEval,
    "http/fetch-needs-timeout": fetchNeedsTimeout,
    "tests/no-focused-tests": noFocusedTests,
    "docs/todo-needs-owner": todoNeedsOwner,
  },
  policy: {
    "danger/lossy-migration": { persistence: "durable", resolution: "human" },
    "security/no-eval": { persistence: "durable" },
  },
  files: ["src/**/*.{ts,tsx,js}"],
  overrides: [
    // UI/data judgment rules are noise inside tests; the focused-test rule
    // is the one that matters there.
    {
      files: ["**/*.test.*"],
      rules: {
        "ui/query-state-coverage": "off",
        "data/bounded-query": "off",
        "http/fetch-needs-timeout": "off",
      },
    },
  ],
  notes: { dirs: [".agents/learn"] },
});
