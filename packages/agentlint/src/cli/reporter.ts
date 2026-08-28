/** Terminal and machine-readable check output. @module @since 0.2.0 */

import { Effect } from "effect";
import { Env } from "../config/env.js";
import type { NormalizedConfig } from "../domain/config.js";
import type { FindingRecord } from "../domain/finding.js";
import { findingKey } from "../domain/finding.js";
import { compactStandard } from "../domain/guidance.js";
import type { CheckLineage } from "../features/check/request.js";

function ansi(noColor: boolean) {
  return {
    bold: (value: string) => (noColor ? value : `\u001b[1m${value}\u001b[22m`),
    dim: (value: string) => (noColor ? value : `\u001b[2m${value}\u001b[22m`),
    yellow: (value: string) => (noColor ? value : `\u001b[33m${value}\u001b[39m`),
    cyan: (value: string) => (noColor ? value : `\u001b[36m${value}\u001b[39m`),
  };
}

export const formatCheckText = Effect.fn("formatCheckText")(function* (
  findings: ReadonlyArray<FindingRecord>,
  config: NormalizedConfig,
  version: string,
  lineage: ReadonlyArray<CheckLineage> = [],
) {
  const colors = ansi((yield* Env).noColor);
  if (findings.length === 0) return `${colors.bold("agentlint")} ${colors.dim(`v${version}`)} — gate open.`;

  const lines = [
    colors.bold(
      colors.yellow(`${findings.length} unresolved finding${findings.length === 1 ? "" : "s"} — gate closed`),
    ),
    "",
  ];
  const groups = new Map<string, FindingRecord[]>();
  for (const finding of findings) {
    const group = groups.get(finding.ruleId);
    if (group) group.push(finding);
    else groups.set(finding.ruleId, [finding]);
  }

  for (const [ruleId, group] of groups) {
    const first = group[0];
    if (first === undefined) continue;
    const rule = config.rulesById.get(ruleId);
    const title = rule?.standard.title;
    const count = `${group.length} finding${group.length === 1 ? "" : "s"}`;
    lines.push(
      colors.bold(
        `${colors.cyan(ruleId)}${title && title !== ruleId ? ` — ${title}` : ""} ${colors.dim(`(${count}, ${first.lifecycle}/${first.authority})`)}`,
      ),
    );

    for (const finding of group) {
      const selector = finding.selector ?? findingKey(finding);
      lines.push(
        `  ${colors.yellow(`[${selector}]`)} ${colors.dim(`${finding.file}:${finding.line}:${finding.column}`)} — ${finding.message}`,
      );
      const prior = lineage.find((entry) => entry.findingKey === findingKey(finding));
      if (prior) {
        lines.push(
          `    Prior judgment (context only): ${prior.reason} ${colors.dim(`(${prior.authority}, ${prior.acceptedAt})`)}`,
        );
      }
    }

    const decision = first.authority === "human" ? "agentlint review" : 'agentlint accept <finding> --reason "..."';
    lines.push(`  ${colors.dim(`Actions: agentlint explain ${ruleId} · ${decision}`)}`, "");
  }
  lines.push(colors.dim("Change the evidence or record an acceptance, then run agentlint check again."));
  return lines.join("\n");
});

export function formatCheckJsonl(
  findings: ReadonlyArray<FindingRecord>,
  config: NormalizedConfig,
  lineage: ReadonlyArray<CheckLineage> = [],
): string {
  return findings
    .map((finding) => {
      const rule = config.rulesById.get(finding.ruleId);
      const selector = finding.selector ?? findingKey(finding);
      return JSON.stringify({
        version: 1,
        type: "finding",
        selector,
        identity: { source: finding.source, fingerprint: finding.fingerprint, lineageKey: finding.lineageKey ?? null },
        rule: {
          id: finding.ruleId,
          title: rule?.standard.title ?? finding.ruleId,
          lifecycle: finding.lifecycle,
          authority: finding.authority,
        },
        location: { file: finding.file, line: finding.line, column: finding.column },
        message: finding.message,
        snippet: finding.sourceSnippet,
        standard: rule ? compactStandard(rule.standard.guidance) : "",
        priorJudgment: lineage.find((entry) => entry.findingKey === findingKey(finding)) ?? null,
        commands: {
          explain: `agentlint explain ${selector}`,
          decide:
            finding.authority === "human"
              ? `agentlint approve ${selector} --reason "..."`
              : `agentlint accept ${selector} --reason "..."`,
        },
      });
    })
    .join("\n");
}
