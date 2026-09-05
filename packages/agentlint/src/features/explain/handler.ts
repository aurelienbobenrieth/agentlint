/** Finding and rule explanation handler. @module @since 0.2.0 */

import { Effect } from "effect";
import { findLineage, invalidationReasons, findingState } from "../../domain/acceptance.js";
import { findingKey } from "../../domain/finding.js";
import { normalizeGuidance } from "../../domain/guidance.js";
import type { AgentlintRule } from "../../domain/rule.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { collectFindings } from "../../shared/pipeline/collect-findings.js";
import { resolveFindingSelector } from "../../shared/pipeline/selectors.js";
import { ExplainCommand, ExplainResult } from "./request.js";

function addGuidance(lines: string[], rule: AgentlintRule): void {
  const guidance = normalizeGuidance(rule.standard.guidance);
  lines.push("## Standard", "", guidance.standard, "");
  if (guidance.checks.length) {
    lines.push("## Decision checks", "", ...guidance.checks.map((check) => `- ${check}`), "");
  }
  if (guidance.examples.length) {
    lines.push("## Permitted examples", "");
    for (const example of guidance.examples) {
      if (example.label) lines.push(`### ${example.label}`, "");
      if (example.description) lines.push(example.description, "");
      lines.push("```ts", example.code, "```", "");
    }
  }
  if (guidance.refs.length || rule.standard.source) {
    lines.push("## References", "");
    if (rule.standard.source) {
      lines.push(
        rule.standard.source.type === "url" ? `- ${rule.standard.source.href}` : `- ${rule.standard.source.path}`,
      );
    }
    for (const ref of guidance.refs) lines.push(ref.type === "skill" ? `- skill:${ref.id}` : `- ${ref.href}`);
  }
}

function explainRule(rule: AgentlintRule): string {
  const lines = [`# ${rule.standard.title}`, "", rule.standard.summary ?? rule.standard.title, ""];
  lines.push(`Rule: ${rule.binding.id}`);
  lines.push(`Lifecycle: ${rule.lifecycle}`);
  lines.push(`Authority: ${rule.binding.authority}`);
  lines.push(`Standard revision: ${rule.standard.revision}`);
  lines.push(`Detector: ${rule.detector.id}@${rule.detector.version}`, "");
  addGuidance(lines, rule);
  lines.push("## Repository scope", "");
  lines.push(`Include: ${rule.binding.include?.join(", ") ?? "all supported files"}`);
  lines.push(`Exclude: ${rule.binding.exclude?.join(", ") ?? "none"}`);
  return lines.join("\n").trimEnd();
}

export const explainHandler = Effect.fn("explainHandler")(function* (command: ExplainCommand) {
  const config = yield* (yield* ConfigLoader).load();
  const directRule = config.rulesById.get(command.selector);
  if (directRule) return new ExplainResult({ output: explainRule(directRule), found: true });

  const selectorCache = yield* SelectorCache;
  const cache = yield* selectorCache.read();
  const collection = yield* collectFindings({ all: true, rules: [], base: config.base, files: [] });
  const resolution = resolveFindingSelector(command.selector, collection.findings, cache);
  if (!resolution.ok) return new ExplainResult({ output: resolution.message, found: false });

  const finding = resolution.finding;
  const rule = config.rulesById.get(finding.ruleId);
  if (!rule) return new ExplainResult({ output: `Unknown rule: ${finding.ruleId}`, found: false });
  const snapshot = yield* (yield* AcceptanceStore).read();
  const state = findingState(finding, snapshot.records);
  const lineage = findLineage(snapshot.records, finding);
  const lines = [`# ${rule.standard.title}`, "", `${finding.file}:${finding.line}:${finding.column}`, ""];
  lines.push(finding.message, "", "```", finding.sourceSnippet, "```", "");
  lines.push(`Finding: ${findingKey(finding)}`);
  lines.push(`State: ${state}`);
  lines.push(`Required authority: ${finding.authority}`, "");
  if (lineage) {
    lines.push(
      "## Prior related judgment",
      "",
      "This prior acceptance is context only. It does not open the gate.",
      "",
    );
    lines.push(...invalidationReasons(lineage, finding));
    lines.push(`Declared actor: ${lineage.actor ?? "unknown"}`);
    lines.push(`Reason: ${lineage.reason}`);
    lines.push(`Authority: ${lineage.authority}`);
    lines.push(`Accepted at: ${lineage.acceptedAt}`, "");
  }
  addGuidance(lines, rule);
  return new ExplainResult({ output: lines.join("\n").trimEnd(), found: true });
});
