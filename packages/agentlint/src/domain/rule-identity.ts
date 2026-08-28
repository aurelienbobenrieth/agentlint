/** Rule composition identity helpers. @module @since 0.2.0 */

import { FindingSource, bindingDigest, type CanonicalValue } from "./fingerprint.js";
import type { AgentlintRule } from "./rule.js";

function materialBinding(rule: AgentlintRule): CanonicalValue {
  return {
    include: [...(rule.binding.include ?? [])],
    exclude: [...(rule.binding.exclude ?? [])],
    options: rule.binding.options === undefined ? null : (rule.binding.options as CanonicalValue),
  };
}

/** Build the exact source identity for all findings from one effective rule. */
export function findingSourceForRule(rule: AgentlintRule): FindingSource {
  return new FindingSource({
    standardId: rule.standard.id,
    standardRevision: rule.standard.revision,
    detectorId: rule.detector.id,
    detectorVersion: rule.detector.version,
    bindingId: rule.binding.id,
    bindingDigest: bindingDigest(materialBinding(rule)),
  });
}
