/**
 * Promise-based testing helpers for rule and plugin authors.
 *
 * These wrap the Effect-based `runRuleFixtures`/`runRuleOnSource` with the
 * live parser layers so a vitest suite needs no Effect plumbing:
 *
 * ```ts
 * import { testRuleFixtures } from "@aurelienbbn/agentlint";
 *
 * it("fixtures hold", async () => {
 *   const report = await testRuleFixtures(myRule);
 *   expect(report.failures).toEqual([]);
 * });
 * ```
 *
 * @module
 * @since 0.2.0
 */

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Env } from "./config/env.js";
import type { FindingRecord } from "./domain/finding.js";
import type { AgentlintRule, ChangeRule, ChangeSet, StateRule } from "./domain/rule.js";
import { Parser } from "./shared/infrastructure/parser.js";
import {
  runRuleFixtures,
  runRuleOnChange,
  runRuleOnSource,
  type FixtureReport,
  type ReportedChangeFinding,
} from "./shared/pipeline/rule-tester.js";

const TestingLayer = Parser.layer.pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(Env.layer));

/**
 * Run a detector's activation and silence fixtures with real parsing.
 *
 * @since 0.2.0
 * @category constructors
 */
export function testRuleFixtures(rule: AgentlintRule): Promise<FixtureReport> {
  return Effect.runPromise(runRuleFixtures(rule).pipe(Effect.provide(TestingLayer)));
}

/**
 * Run a rule against one in-memory snippet with real parsing. `file` is a
 * pseudo-filename whose extension selects the grammar (default `fixture.tsx`).
 *
 * @since 0.2.0
 * @category constructors
 */
export function testRuleOnSource(
  rule: StateRule,
  source: string,
  file = "fixture.tsx",
): Promise<ReadonlyArray<FindingRecord>> {
  return Effect.runPromise(runRuleOnSource(rule, source, file).pipe(Effect.provide(TestingLayer)));
}

/** Run a change rule against normalized, caller-provided change evidence. */
export function testRuleOnChange(rule: ChangeRule, change: ChangeSet): ReadonlyArray<ReportedChangeFinding> {
  return runRuleOnChange(rule, change);
}
