import { changeFixture } from "./change-fixture.js";
import type { FixtureReport, FixtureFailure } from "../../domain/fixture-report.js";
/**
 * Detector fixture runners. @module @since 0.2.0
 */

import { Effect, Schema } from "effect";
import { compareStrings } from "../../domain/compare.js";
import type { FindingRecord } from "../../domain/finding.js";
import {
  type AgentlintRule,
  type ChangeFixture,
  type ChangeRule,
  type StateFixture,
  type StateRule,
} from "../../domain/rule/model.js";
import { grammarForExtension } from "./language-map.js";
import { PatternError } from "../../domain/pattern-error.js";
import { collectStateFindings, detectChange } from "./collect-findings.js";

/**
 * Run one state detector against an in-memory repository.
 */
export const runRuleOnSources = Effect.fn("runRuleOnSources")(function* (
  rule: StateRule,
  sources: ReadonlyArray<readonly [file: string, source: string]>,
) {
  for (const [file] of sources) {
    if (!grammarForExtension(file.split(".").pop() ?? "") && !(rule.binding.dependencies ?? []).includes(file)) {
      return yield* new PatternError({ ruleId: rule.binding.id, reason: "unknown_fixture_grammar", detail: file });
    }
  }
  return yield* collectStateFindings(
    [rule],
    sources.map(([file]) => file),
    new Map(sources),
  );
});

/**
 * Run one state detector against one source file.
 */
export const runRuleOnSource = Effect.fn("runRuleOnSource")(function* (
  rule: StateRule,
  source: string,
  file = "fixture.tsx",
) {
  return yield* runRuleOnSources(rule, [[file, source]]);
});

/**
 * Normalize one change fixture and run the detector against it. Findings use the same fingerprint and lineage
 * construction as `agentlint check`.
 */
export const runRuleOnChangeFixture = Effect.fn("runRuleOnChangeFixture")(function* ({
  rule,
  fixture,
}: {
  readonly rule: ChangeRule;
  readonly fixture: ChangeFixture;
}) {
  return yield* detectChange({ rule, change: yield* changeFixture(fixture) });
});

function stateFiles(fixture: StateFixture): ReadonlyArray<readonly [string, string]> {
  if (Schema.is(Schema.String)(fixture)) return [["fixture.tsx", fixture]];
  if ("source" in fixture) return [[fixture.file ?? "fixture.tsx", fixture.source]];
  return Object.entries(fixture.files).toSorted(([left], [right]) => compareStrings({ left, right }));
}

function fixtureLabel(fixture: StateFixture | ChangeFixture): string | undefined {
  return Schema.is(Schema.String)(fixture) ? undefined : fixture.label;
}

const runStateFixture = Effect.fn("runStateFixture")(function* (rule: StateRule, fixture: StateFixture) {
  return yield* runRuleOnSources(rule, stateFiles(fixture));
});

const sameFindings = (left: ReadonlyArray<FindingRecord>, right: ReadonlyArray<FindingRecord>): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const nondeterministic = ({
  index,
  fixture,
  findings,
}: {
  readonly index: number;
  readonly fixture: StateFixture | ChangeFixture;
  readonly findings: ReadonlyArray<FindingRecord>;
}): FixtureFailure => ({
  expectation: "deterministic",
  index,
  label: fixtureLabel(fixture),
  findingCount: findings.length,
});

/**
 * Run activation and silence fixtures for either lifecycle.
 */
export const runRuleFixtures = Effect.fn("runRuleFixtures")(function* (rule: AgentlintRule) {
  const failures: FixtureFailure[] = [];
  if (rule.lifecycle === "state") {
    const mustReport = rule.detector.fixtures?.mustReport ?? [];
    const mustStaySilent = rule.detector.fixtures?.mustStaySilent ?? [];
    for (const [index, fixture] of mustReport.entries()) {
      const findings = yield* runStateFixture(rule, fixture);
      const replay = yield* runStateFixture(rule, fixture);
      if (!sameFindings(findings, replay)) failures.push(nondeterministic({ index, fixture, findings }));
      if (findings.length === 0)
        failures.push({ expectation: "mustReport", index, label: fixtureLabel(fixture), findingCount: 0 });
    }
    for (const [index, fixture] of mustStaySilent.entries()) {
      const findings = yield* runStateFixture(rule, fixture);
      const replay = yield* runStateFixture(rule, fixture);
      if (!sameFindings(findings, replay)) failures.push(nondeterministic({ index, fixture, findings }));
      if (findings.length > 0)
        failures.push({
          expectation: "mustStaySilent",
          index,
          label: fixtureLabel(fixture),
          findingCount: findings.length,
        });
    }
    return {
      ruleId: rule.binding.id,
      total: mustReport.length + mustStaySilent.length,
      failures,
    } satisfies FixtureReport;
  }

  const mustReport = rule.detector.fixtures?.mustReport ?? [];
  const mustStaySilent = rule.detector.fixtures?.mustStaySilent ?? [];
  for (const [index, fixture] of mustReport.entries()) {
    const change = yield* changeFixture(fixture);
    const findings = yield* detectChange({ rule, change });
    const replay = yield* detectChange({ rule, change });
    if (!sameFindings(findings, replay)) failures.push(nondeterministic({ index, fixture, findings }));
    if (findings.length === 0)
      failures.push({ expectation: "mustReport", index, label: fixtureLabel(fixture), findingCount: 0 });
  }
  for (const [index, fixture] of mustStaySilent.entries()) {
    const change = yield* changeFixture(fixture);
    const findings = yield* detectChange({ rule, change });
    const replay = yield* detectChange({ rule, change });
    if (!sameFindings(findings, replay)) failures.push(nondeterministic({ index, fixture, findings }));
    if (findings.length > 0)
      failures.push({
        expectation: "mustStaySilent",
        index,
        label: fixtureLabel(fixture),
        findingCount: findings.length,
      });
  }

  return {
    ruleId: rule.binding.id,
    total: mustReport.length + mustStaySilent.length,
    failures,
  } satisfies FixtureReport;
});
