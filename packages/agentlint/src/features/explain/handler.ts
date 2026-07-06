import { Effect } from "effect";
import { normalizeConfig, policyForRule } from "../../domain/config.js";
import { normalizeGuidance } from "../../domain/guidance.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { ledgerKey, LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { resolveFindingSelector } from "../../shared/pipeline/selectors.js";
import { ExplainCommand, ExplainResult } from "./request.js";

function formatGuidanceLines(lines: string[], guidance: ReturnType<typeof normalizeGuidance>): void {
  lines.push("## Guidance", "");
  lines.push(guidance.standard, "");
  if (guidance.checks.length > 0) {
    lines.push("## Checks", "");
    for (const check of guidance.checks) {
      lines.push(`- ${check}`);
    }
    lines.push("");
  }
  if (guidance.examples.length > 0) {
    lines.push("## Examples", "");
    for (const example of guidance.examples) {
      if (example.label) lines.push(`### ${example.label}`, "");
      if (example.bad) lines.push("Bad:", "```ts", example.bad, "```", "");
      if (example.good) lines.push("Good:", "```ts", example.good, "```", "");
    }
  }
  if (guidance.refs.length > 0) {
    lines.push("## Refs", "");
    for (const ref of guidance.refs) {
      lines.push(ref.type === "skill" ? `- skill:${ref.id}` : `- ${ref.href}`);
    }
    lines.push("");
  }
}

export const explainHandler = Effect.fn("explainHandler")(function* (command: ExplainCommand) {
  const configLoader = yield* ConfigLoader;
  const ledgerStore = yield* LedgerStore;
  const selectorCache = yield* SelectorCache;
  const config = normalizeConfig(yield* configLoader.load());

  const directRule = config.rules[command.selector];
  if (directRule) {
    const lines = [`# ${directRule.id}`, "", directRule.description, ""];
    lines.push(`Persistence: ${policyForRule(config, directRule.id).persistence}`, "");
    formatGuidanceLines(lines, normalizeGuidance(directRule.guidance));
    lines.push("## Applicability", "");
    lines.push(`Files: ${config.files?.join(", ") ?? "all supported files"}`);
    if (config.ignores.length > 0) lines.push(`Ignores: ${config.ignores.join(", ")}`);
    lines.push(`Overrides: ${config.overrides.length}`);
    return new ExplainResult({ output: lines.join("\n").trimEnd(), found: true });
  }

  const cache = yield* selectorCache.read();
  const collection = yield* collectFindings({ all: true, rules: [], base: undefined, files: [] });
  const resolution = resolveFindingSelector(command.selector, collection.findings, cache);
  if (!resolution.ok) {
    return new ExplainResult({ output: resolution.message, found: false });
  }

  const finding = resolution.finding;
  const rule = config.rules[finding.ruleId];
  if (!rule) {
    return new ExplainResult({ output: `Rule not found for current finding: ${finding.ruleId}`, found: false });
  }

  const snapshot = yield* ledgerStore.read();
  const ledgerRecord = snapshot.latestByKey.get(ledgerKey(finding.ruleId, finding.hash));
  const lines = [`# ${finding.ruleId} ${finding.file}:${finding.line}:${finding.column}`, ""];
  lines.push(finding.message, "");
  if (finding.sourceSnippet) {
    lines.push("```ts", finding.sourceSnippet, "```", "");
  }
  lines.push(`Hash: ${finding.hash}`);
  lines.push(`Persistence: ${policyForRule(config, finding.ruleId).persistence}`, "");
  if (ledgerRecord) {
    lines.push("## Ledger", "");
    lines.push(`Status: ${ledgerRecord.status}`);
    lines.push(`Reason: ${ledgerRecord.reason}`);
    lines.push(`Actor: ${ledgerRecord.actor}`);
    lines.push(`At: ${ledgerRecord.at}`, "");
  }
  formatGuidanceLines(lines, normalizeGuidance(rule.guidance));

  return new ExplainResult({ output: lines.join("\n").trimEnd(), found: true });
});
