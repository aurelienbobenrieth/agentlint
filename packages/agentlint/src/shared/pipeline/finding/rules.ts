/**
 * Rule selection, scope, and stable finding order. @module
 */

import { compareStrings } from "../../../domain/compare.js";
import type { NormalizedConfig } from "../../../domain/config.js";
import type { FindingRecord } from "../../../domain/finding.js";
import type { AgentlintRule } from "../../../domain/rule/model.js";
import { compileGlobs } from "../file-resolver.js";

export type ScopeMatcher = (file: string) => boolean;

export function scopeMatcher(rule: AgentlintRule): ScopeMatcher {
  const included = compileGlobs(rule.binding.include);
  const excluded = compileGlobs(rule.binding.exclude);
  if (!included && !excluded) return () => true;
  return (file) => (included ? included(file) : true) && !(excluded ? excluded(file) : false);
}

export function ruleEnabledForFile({ rule, file }: { readonly rule: AgentlintRule; readonly file: string }): boolean {
  return scopeMatcher(rule)(file);
}

export function filterRules({
  config,
  requested,
}: {
  readonly config: NormalizedConfig;
  readonly requested: ReadonlyArray<string>;
}): ReadonlyArray<AgentlintRule> {
  if (requested.length === 0) return config.rules;
  return config.rules.filter((rule) => requested.includes(rule.binding.id));
}

export function sortFindings(findings: ReadonlyArray<FindingRecord>): FindingRecord[] {
  return findings.toSorted(
    (left, right) =>
      compareStrings({ left: left.file, right: right.file }) ||
      left.line - right.line ||
      left.column - right.column ||
      compareStrings({ left: left.ruleId, right: right.ruleId }) ||
      compareStrings({ left: left.fingerprint.digest, right: right.fingerprint.digest }),
  );
}
