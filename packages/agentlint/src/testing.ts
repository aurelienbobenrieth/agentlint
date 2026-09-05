/**
 * Promise-based testing helpers for rule and plugin authors.
 *
 * These wrap the Effect-based fixture runners with the live parser layers so
 * a vitest suite needs no Effect plumbing:
 *
 * ```ts
 * import { testRuleFixtures } from "@aurelienbbn/agentlint/testing";
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
import type { AgentlintRule, ChangeFixture, ChangeRule, StateRule } from "./domain/rule.js";
import { Parser } from "./shared/infrastructure/parser.js";
import {
  normalizeChangeFixture,
  runRuleFixtures,
  runRuleOnChange,
  runRuleOnSource,
  runRuleOnSources,
  type FixtureReport,
} from "./shared/pipeline/rule-tester.js";

export { normalizeChangeFixture };
export type { FixtureFailure, FixtureReport } from "./shared/pipeline/rule-tester.js";

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
 * Run a state rule against one in-memory snippet with real parsing. `file` is
 * a pseudo-filename whose extension selects the grammar (default `fixture.tsx`).
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

/**
 * Run a change rule against one fixture, either compact before/after
 * repositories or an exact normalized change set. Returns the same
 * `FindingRecord` shape `agentlint check` produces.
 *
 * @since 0.2.0
 * @category constructors
 */
export function testRuleOnChange(rule: ChangeRule, fixture: ChangeFixture): Promise<ReadonlyArray<FindingRecord>> {
  return Promise.resolve(runRuleOnChange(rule, normalizeChangeFixture(fixture)));
}

/** Run repository-wide detector fixtures without exposing engine infrastructure. */
export function testRuleOnSources(
  rule: StateRule,
  sources: ReadonlyArray<readonly [string, string]>,
): Promise<ReadonlyArray<FindingRecord>> {
  return Effect.runPromise(runRuleOnSources(rule, sources).pipe(Effect.provide(TestingLayer)));
}
