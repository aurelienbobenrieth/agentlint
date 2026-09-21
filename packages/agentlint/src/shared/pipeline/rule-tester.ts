import { normalizeChangeFixture } from "./change-fixture.js";
import type { FixtureReport, FixtureFailure } from "../../domain/fixture-report.js";
/**
 * Detector fixture runners. @module @since 0.2.0
 */

import { Effect } from "effect";
import { ChangeRuleContextImpl } from "../../domain/change-rule-context.js";
import { compareStrings } from "../../domain/compare.js";
import type { FindingRecord } from "../../domain/finding.js";
import {
  type AgentlintRule,
  type ChangeFixture,
  type ChangeRule,
  type ChangeSet,
  type StateFixture,
  type StateRule,
} from "../../domain/rule.js";
import { grammarForExtension } from "./language-map.js";
import { PatternError } from "../../domain/pattern-error.js";
import { collectStateFindings } from "./collect-findings.js";

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
 * Run one change detector against an already normalized change. Findings use the same fingerprint and lineage
 * construction as `agentlint check`; the absolute path is the fixture path itself.
 */
export function runRuleOnChange(rule: ChangeRule, change: ChangeSet): ReadonlyArray<FindingRecord> {
  const context = new ChangeRuleContextImpl(rule, change);
  rule.detector.detect(context, rule.binding.options);
  return context.findings;
}

function stateFiles(fixture: StateFixture): ReadonlyArray<readonly [string, string]> {
  if (typeof fixture === "string") return [["fixture.tsx", fixture]];
  if ("source" in fixture) return [[fixture.file ?? "fixture.tsx", fixture.source]];
  return Object.entries(fixture.files).toSorted(([left], [right]) => compareStrings(left, right));
}

function fixtureLabel(fixture: StateFixture | ChangeFixture): string | undefined {
  return typeof fixture === "string" ? undefined : fixture.label;
}

const runStateFixture = Effect.fn("runStateFixture")(function* (rule: StateRule, fixture: StateFixture) {
  return (yield* runRuleOnSources(rule, stateFiles(fixture))).length;
});

/**
 * Run activation and silence fixtures for either lifecycle.
 */
export const runRuleFixtures = Effect.fn("runRuleFixtures")(function* (rule: AgentlintRule) {
  const fixtures = rule.detector.fixtures;
  const mustReport = fixtures?.mustReport ?? [];
  const mustStaySilent = fixtures?.mustStaySilent ?? [];
  const failures: FixtureFailure[] = [];

  for (const [index, fixture] of mustReport.entries()) {
    const count =
      rule.lifecycle === "state"
        ? yield* runStateFixture(rule, fixture as StateFixture)
        : runRuleOnChange(rule, normalizeChangeFixture(fixture as ChangeFixture)).length;
    if (count === 0) failures.push({ expectation: "mustReport", index, label: fixtureLabel(fixture), findingCount: 0 });
  }
  for (const [index, fixture] of mustStaySilent.entries()) {
    const count =
      rule.lifecycle === "state"
        ? yield* runStateFixture(rule, fixture as StateFixture)
        : runRuleOnChange(rule, normalizeChangeFixture(fixture as ChangeFixture)).length;
    if (count > 0)
      failures.push({ expectation: "mustStaySilent", index, label: fixtureLabel(fixture), findingCount: count });
  }

  return {
    ruleId: rule.binding.id,
    total: mustReport.length + mustStaySilent.length,
    failures,
  } satisfies FixtureReport;
});
