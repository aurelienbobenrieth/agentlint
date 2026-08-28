/** Rule listing, fixture testing, and calibration handlers. @module @since 0.2.0 */

import { Effect } from "effect";
import { normalizeConfig } from "../../domain/config.js";
import type { AgentlintRule } from "../../domain/rule.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { collectFindings, ruleEnabledForFile } from "../../shared/pipeline/collect-findings.js";
import { runRuleFixtures } from "../../shared/pipeline/rule-tester.js";
import {
  RulesListCommand,
  RulesListResult,
  RulesScanCommand,
  RulesScanResult,
  RulesTestCommand,
  RulesTestResult,
} from "./request.js";

function selectRules(
  rules: ReadonlyArray<AgentlintRule>,
  requested: ReadonlyArray<string>,
): ReadonlyArray<AgentlintRule> {
  return requested.length ? rules.filter((rule) => requested.includes(rule.binding.id)) : rules;
}

export const rulesListHandler = Effect.fn("rulesListHandler")(function* (command: RulesListCommand) {
  const config = normalizeConfig(yield* (yield* ConfigLoader).load());
  const file = command.file?.replace(/\\/g, "/");
  return new RulesListResult({
    rules: config.rules
      .map((rule) => ({
        id: rule.binding.id,
        title: rule.standard.title,
        standardId: rule.standard.id,
        lifecycle: rule.lifecycle,
        authority: rule.binding.authority,
        detector: `${rule.detector.id}@${rule.detector.version}`,
        enabled: file ? ruleEnabledForFile(rule, file) : true,
      }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  });
});

export const rulesTestHandler = Effect.fn("rulesTestHandler")(function* (command: RulesTestCommand) {
  const config = normalizeConfig(yield* (yield* ConfigLoader).load());
  const rules = selectRules(config.rules, command.rules).toSorted((left, right) =>
    left.binding.id.localeCompare(right.binding.id),
  );
  if (rules.length === 0) {
    return new RulesTestResult({
      message: `No matching rules. Available: ${config.rules
        .map((rule) => rule.binding.id)
        .toSorted()
        .join(", ")}`,
      exitCode: 2,
    });
  }

  const lines: string[] = [];
  let failed = 0;
  let withoutFixtures = 0;
  for (const rule of rules) {
    const report = yield* runRuleFixtures(rule);
    if (report.total === 0) {
      withoutFixtures++;
      lines.push(`skip ${report.ruleId} (no fixtures)`);
      continue;
    }
    if (report.failures.length === 0) {
      lines.push(`pass ${report.ruleId} (${report.total} fixture${report.total === 1 ? "" : "s"})`);
      continue;
    }
    failed++;
    lines.push(`FAIL ${report.ruleId} (${report.failures.length}/${report.total} fixtures failed)`);
    for (const failure of report.failures) {
      const expectation =
        failure.expectation === "mustReport"
          ? "expected at least one finding, got none"
          : `expected no findings, got ${failure.findingCount}`;
      lines.push(
        `  ${failure.expectation}[${failure.index}]${failure.label ? ` ${failure.label}` : ""}: ${expectation}`,
      );
    }
  }
  const parts = [`${rules.length - failed - withoutFixtures} passed`];
  if (failed) parts.push(`${failed} failed`);
  if (withoutFixtures) parts.push(`${withoutFixtures} without fixtures`);
  lines.push("", parts.join(", "));
  return new RulesTestResult({ message: lines.join("\n"), exitCode: failed ? 1 : 0 });
});

export const rulesScanHandler = Effect.fn("rulesScanHandler")(function* (command: RulesScanCommand) {
  const fixtures = yield* rulesTestHandler(new RulesTestCommand({ rules: [...command.rules] }));
  if (fixtures.exitCode !== 0) {
    return new RulesScanResult({ findings: [], fixtureMessage: fixtures.message, exitCode: fixtures.exitCode });
  }
  const collected = yield* collectFindings({
    all: true,
    rules: [...command.rules],
    base: command.base,
    files: [...command.files],
  });
  return new RulesScanResult({ findings: [...collected.findings], fixtureMessage: fixtures.message, exitCode: 0 });
});
