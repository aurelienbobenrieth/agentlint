/**
 * Rule fixture runner.
 *
 * Executes a rule against in-memory source snippets. Used by
 * `agentlint rules test` and exported for plugin authors who want to
 * assert rule precision inside their own test suites.
 *
 * @module
 * @since 0.2.0
 */

import { Effect } from "effect";
import type { FindingRecord } from "../../domain/finding.js";
import { ruleMatches, type AgentlintRule } from "../../domain/rule.js";
import { RuleContextImpl } from "../../domain/rule-context.js";
import { Parser } from "../infrastructure/parser.js";
import { grammarForExtension } from "./language-map.js";
import { compileMatches, PatternError, resolveWhereClauses, runMatches } from "./pattern-match.js";
import { walkFile } from "./tree-walker.js";

/**
 * Run a single rule against one in-memory source snippet.
 *
 * `file` is a pseudo-filename whose extension selects the grammar
 * (e.g. `fixture.tsx`).
 *
 * @since 0.2.0
 * @category constructors
 */
export const runRuleOnSource = Effect.fn("runRuleOnSource")(function* (
  rule: AgentlintRule,
  source: string,
  file: string,
) {
  const parser = yield* Parser;
  const extension = file.includes(".") ? (file.split(".").pop() ?? "") : "";
  const grammar = grammarForExtension(extension);
  if (!grammar) {
    return yield* new PatternError({ message: `No grammar registered for fixture file "${file}"` });
  }

  const context = new RuleContextImpl(rule.id);
  context.setFile(file, file, source);
  const visitors = rule.createOnce?.(context) ?? {};
  if (visitors.before?.(file) === false) return [] as ReadonlyArray<FindingRecord>;

  const tree = yield* parser.parse(source, grammar);

  const matches = ruleMatches(rule);
  if (matches.length > 0) {
    const compiled = yield* compileMatches({ ruleId: rule.id, matches, grammar });
    const runnable = yield* resolveWhereClauses(rule.id, compiled, grammar);
    runMatches(tree, runnable, context);
  }

  const findings = [...walkFile(tree, [{ ruleId: rule.id, context, visitors }])];
  visitors.after?.();
  findings.push(...context.drainFindings());
  return findings as ReadonlyArray<FindingRecord>;
});

/**
 * One fixture expectation that did not hold.
 *
 * @since 0.2.0
 * @category models
 */
export interface FixtureFailure {
  readonly kind: "invalid" | "valid";
  readonly index: number;
  readonly code: string;
  readonly findingCount: number;
}

/**
 * @since 0.2.0
 * @category models
 */
export interface FixtureReport {
  readonly ruleId: string;
  readonly total: number;
  readonly failures: ReadonlyArray<FixtureFailure>;
}

/**
 * Run all fixtures of a rule: `invalid` snippets must produce at least one
 * finding, `valid` snippets none.
 *
 * @since 0.2.0
 * @category constructors
 */
export const runRuleFixtures = Effect.fn("runRuleFixtures")(function* (rule: AgentlintRule) {
  const file = rule.fixtures?.file ?? "fixture.tsx";
  const invalid = rule.fixtures?.invalid ?? [];
  const valid = rule.fixtures?.valid ?? [];
  const failures: FixtureFailure[] = [];

  for (const [index, code] of invalid.entries()) {
    const findings = yield* runRuleOnSource(rule, code, file);
    if (findings.length === 0) {
      failures.push({ kind: "invalid", index, code, findingCount: 0 });
    }
  }
  for (const [index, code] of valid.entries()) {
    const findings = yield* runRuleOnSource(rule, code, file);
    if (findings.length > 0) {
      failures.push({ kind: "valid", index, code, findingCount: findings.length });
    }
  }

  return {
    ruleId: rule.id,
    total: invalid.length + valid.length,
    failures,
  } satisfies FixtureReport;
});
