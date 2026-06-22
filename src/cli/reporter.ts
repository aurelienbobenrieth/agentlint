/**
 * CLI reporters for check output.
 *
 * @module
 * @since 0.1.0
 */

import { Effect, Schema } from "effect";
import { Env } from "../config/env.js";
import { compactStandard, normalizeGuidance } from "../domain/guidance.js";
import type { FindingRecord } from "../domain/finding.js";
import type { NormalizedConfig } from "../domain/config.js";
import { policyForRule } from "../domain/config.js";

/**
 * Group an array by a key function, returning a HashMap of arrays.
 *
 * @since 0.1.0
 * @category internals
 */
function makeAnsi(noColor: boolean) {
  return {
    bold: (s: string) => (noColor ? s : `\x1b[1m${s}\x1b[22m`),
    dim: (s: string) => (noColor ? s : `\x1b[2m${s}\x1b[22m`),
    yellow: (s: string) => (noColor ? s : `\x1b[33m${s}\x1b[39m`),
    cyan: (s: string) => (noColor ? s : `\x1b[36m${s}\x1b[39m`),
  };
}

/**
 * Options that control the reporter's output format.
 *
 * @since 0.1.0
 * @category models
 */
export const ReporterOptions = Schema.Struct({
  version: Schema.String,
  ci: Schema.Boolean,
});

/** @since 0.1.0 */
export type ReporterOptions = Schema.Schema.Type<typeof ReporterOptions>;

/**
 * Format flag results into a terminal-friendly report string.
 *
 * Groups flags by rule name, then by file path. Includes source
 * snippets, per-match instructions/hints, and a summary line.
 * Returns a single "no rules triggered" line when the flag list
 * is empty.
 *
 * Uses the `Env` service for colour/cwd detection and the Effect
 * `Path` service for cross-platform path resolution.
 *
 * @since 0.1.0
 * @category constructors
 */
export const formatCheckText = Effect.fn("formatCheckText")(function* (
  findings: ReadonlyArray<FindingRecord>,
  config: NormalizedConfig,
  options: ReporterOptions,
) {
  const env = yield* Env;
  const ansi = makeAnsi(env.noColor);
  const lines: string[] = [];

  if (findings.length === 0) {
    lines.push(`${ansi.bold("agentlint")} ${ansi.dim(`v${options.version}`)} - no unresolved findings.`);
    return lines.join("\n");
  }

  const noun = findings.length === 1 ? "finding" : "findings";
  const scope = options.ci ? "blocking CI" : "unresolved";
  lines.push(ansi.bold(ansi.yellow(`Found ${findings.length} ${scope} ${noun}`)));
  lines.push("");

  for (const finding of findings) {
    const rule = config.rules[finding.ruleId];
    const policy = policyForRule(config, finding.ruleId);
    const loc = `${finding.file}:${finding.line}:${finding.column}`;
    const selector = finding.selector ? `[${finding.selector}]` : `[${finding.hash}]`;
    const standard = rule ? compactStandard(rule.guidance) : "";

    lines.push(`${ansi.yellow(selector)} ${ansi.cyan(finding.ruleId)} ${ansi.dim(loc)}`);
    lines.push(`  ${finding.message}`);
    if (finding.sourceSnippet && finding.sourceSnippet !== finding.message) {
      lines.push(`  ${ansi.dim(finding.sourceSnippet)}`);
    }
    if (standard) {
      lines.push(`  Standard: ${standard}`);
    }
    lines.push(`  Persistence: ${policy.persistence}`);
    lines.push(`  Explain: agentlint explain ${finding.selector ?? finding.hash}`);
    lines.push(`  Resolve: agentlint resolve ${finding.selector ?? finding.hash} --accept --reason "..."`);
    lines.push(`           agentlint resolve ${finding.selector ?? finding.hash} --defer --reason "..."`);
    lines.push(`           agentlint resolve ${finding.selector ?? finding.hash} --no-fix --reason "..."`);
    lines.push("");
  }

  lines.push(ansi.dim("Fix the code or record an explicit disposition, then rerun agentlint check."));
  return lines.join("\n");
});

export function formatCheckJsonl(findings: ReadonlyArray<FindingRecord>, config: NormalizedConfig): string {
  return findings
    .map((finding) => {
      const rule = config.rules[finding.ruleId];
      const guidance = rule ? normalizeGuidance(rule.guidance) : undefined;
      const policy = policyForRule(config, finding.ruleId);
      const selector = finding.selector ?? finding.hash;

      return JSON.stringify({
        selector,
        hash: finding.hash,
        ruleId: finding.ruleId,
        description: rule?.description ?? "",
        persistence: policy.persistence,
        file: finding.file,
        line: finding.line,
        column: finding.column,
        message: finding.message,
        standard: guidance?.standard ?? "",
        detailCommand: `agentlint explain ${selector}`,
        resolveCommands: {
          accept: `agentlint resolve ${selector} --accept --reason "..."`,
          defer: `agentlint resolve ${selector} --defer --reason "..."`,
          noFix: `agentlint resolve ${selector} --no-fix --reason "..."`,
        },
      });
    })
    .join("\n");
}
