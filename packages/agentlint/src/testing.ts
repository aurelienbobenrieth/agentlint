import { normalizeChangeFixture } from "./shared/pipeline/change-fixture.js";
import type { FixtureReport } from "./domain/fixture-report.js";
/**
 * Promise-based testing helpers for rule and plugin authors.
 *
 * These wrap the Effect-based fixture runners with the live parser layers so a vitest suite needs no Effect plumbing:
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
import { Layer, ManagedRuntime } from "effect";
import { Env } from "./config/env.js";
import type { FindingRecord } from "./domain/finding.js";
import type { AgentlintRule, ChangeFixture, ChangeRule, StateRule } from "./domain/rule.js";
import { Parser } from "./shared/infrastructure/parser.js";
import { runRuleFixtures, runRuleOnChange, runRuleOnSource, runRuleOnSources } from "./shared/pipeline/rule-tester.js";

export { normalizeChangeFixture };
export type { FixtureFailure, FixtureReport } from "./domain/fixture-report.js";

const TestingLayer = Parser.layer.pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, Env.layer)));
const TestingRuntime = ManagedRuntime.make(TestingLayer);

/**
 * Run a detector's activation and silence fixtures with real parsing.
 *
 * @since 0.2.0
 * @category Constructors
 */
export function testRuleFixtures(rule: AgentlintRule): Promise<FixtureReport> {
  return TestingRuntime.runPromise(runRuleFixtures(rule));
}

/**
 * Run a state rule against one in-memory snippet with real parsing. `file` is a pseudo-filename whose extension selects
 * the grammar (default `fixture.tsx`).
 *
 * @since 0.2.0
 * @category Constructors
 */
export function testRuleOnSource({
  rule,
  source,
  file = "fixture.tsx",
}: {
  readonly rule: StateRule;
  readonly source: string;
  readonly file?: string;
}): Promise<ReadonlyArray<FindingRecord>> {
  return TestingRuntime.runPromise(runRuleOnSource(rule, source, file));
}

/**
 * Run a change rule against one fixture, either compact before/after repositories or an exact normalized change set.
 * Returns the same `FindingRecord` shape `agentlint check` produces.
 *
 * @since 0.2.0
 * @category Constructors
 */
export function testRuleOnChange({
  rule,
  fixture,
}: {
  readonly rule: ChangeRule;
  readonly fixture: ChangeFixture;
}): Promise<ReadonlyArray<FindingRecord>> {
  return Promise.resolve(runRuleOnChange({ rule, change: normalizeChangeFixture(fixture) }));
}

/**
 * Run repository-wide detector fixtures without exposing engine infrastructure.
 */
export function testRuleOnSources({
  rule,
  sources,
}: {
  readonly rule: StateRule;
  readonly sources: ReadonlyArray<readonly [string, string]>;
}): Promise<ReadonlyArray<FindingRecord>> {
  return TestingRuntime.runPromise(runRuleOnSources(rule, sources));
}
