import { Effect } from "effect";
import { compactStandard } from "../../domain/guidance.js";
import { normalizeConfig, policyForRule } from "../../domain/config.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { ruleEnabledForFile } from "../../shared/pipeline/collect-findings.js";
import { runRuleFixtures } from "../../shared/pipeline/rule-tester.js";
import { RulesListCommand, RulesListResult, RulesTestCommand, RulesTestResult } from "./request.js";

export const rulesListHandler = Effect.fn("rulesListHandler")(function* (command: RulesListCommand) {
  const configLoader = yield* ConfigLoader;
  const config = normalizeConfig(yield* configLoader.load());
  const file = command.file?.replace(/\\/g, "/");

  return new RulesListResult({
    rules: Object.values(config.rules)
      .map((rule) => ({
        id: rule.id,
        description: rule.description,
        persistence: policyForRule(config, rule.id).persistence ?? "ephemeral",
        standard: compactStandard(rule.guidance),
        enabled: file ? ruleEnabledForFile(config, file, rule.id) : true,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
  });
});

export const rulesTestHandler = Effect.fn("rulesTestHandler")(function* (command: RulesTestCommand) {
  const configLoader = yield* ConfigLoader;
  const config = normalizeConfig(yield* configLoader.load());

  let rules = Object.values(config.rules).toSorted((a, b) => a.id.localeCompare(b.id));
  if (command.rules.length > 0) {
    rules = rules.filter((rule) => command.rules.includes(rule.id));
    if (rules.length === 0) {
      return new RulesTestResult({
        message: `No matching rules. Available: ${Object.keys(config.rules).toSorted().join(", ")}`,
        exitCode: 2,
      });
    }
  }

  const lines: string[] = [];
  let failedRules = 0;
  let skipped = 0;

  for (const rule of rules) {
    const invalid = rule.fixtures?.invalid ?? [];
    const valid = rule.fixtures?.valid ?? [];
    if (invalid.length === 0 && valid.length === 0) {
      skipped++;
      lines.push(`skip ${rule.id} (no fixtures)`);
      continue;
    }

    const report = yield* runRuleFixtures(rule);
    if (report.failures.length === 0) {
      lines.push(`pass ${rule.id} (${report.total} fixture${report.total === 1 ? "" : "s"})`);
    } else {
      failedRules++;
      lines.push(`FAIL ${rule.id} (${report.failures.length}/${report.total} fixtures failed)`);
      for (const failure of report.failures) {
        const expectation =
          failure.kind === "invalid"
            ? "expected at least one finding, got none"
            : `expected no findings, got ${failure.findingCount}`;
        lines.push(`  ${failure.kind}[${failure.index}]: ${expectation}`);
        const snippet = failure.code.trim().split("\n")[0] ?? "";
        lines.push(`    ${snippet.length > 80 ? snippet.slice(0, 77) + "..." : snippet}`);
      }
    }
  }

  const summaryParts = [`${rules.length - failedRules - skipped} passed`];
  if (failedRules > 0) summaryParts.push(`${failedRules} failed`);
  if (skipped > 0) summaryParts.push(`${skipped} without fixtures`);
  lines.push("", summaryParts.join(", "));

  return new RulesTestResult({ message: lines.join("\n"), exitCode: failedRules > 0 ? 1 : 0 });
});
