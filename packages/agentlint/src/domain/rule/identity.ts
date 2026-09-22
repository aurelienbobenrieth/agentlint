/**
 * Rule composition identity helpers. @module @since 0.2.0
 */

import { FindingSource, bindingDigest, type CanonicalValue } from "../fingerprint.js";

interface IdentityRule {
  readonly lifecycle: "state" | "change";
  readonly standard: { readonly id: string; readonly revision: number };
  readonly detector: {
    readonly id: string;
    readonly version: number;
    readonly scan?: "file" | "repository" | undefined;
    readonly createOnce?: unknown;
  };
  readonly binding: {
    readonly id: string;
    readonly include?: ReadonlyArray<string> | undefined;
    readonly exclude?: ReadonlyArray<string> | undefined;
    readonly dependencies?: ReadonlyArray<string> | undefined;
    readonly options?: CanonicalValue | undefined;
  };
}

function materialBinding(rule: IdentityRule): CanonicalValue {
  return {
    include: [...(rule.binding.include ?? [])],
    exclude: [...(rule.binding.exclude ?? [])],
    dependencies: [...(rule.binding.dependencies ?? [])].toSorted((left, right) => left.localeCompare(right)),
    scan:
      rule.lifecycle === "state"
        ? (rule.detector.scan ?? (rule.detector.createOnce ? "repository" : "file"))
        : "change",
    options: rule.binding.options === undefined ? null : rule.binding.options,
  };
}

/**
 * Build the exact source identity for all findings from one effective rule.
 */
export function findingSourceForRule(rule: IdentityRule): FindingSource {
  return new FindingSource({
    standardId: rule.standard.id,
    standardRevision: rule.standard.revision,
    detectorId: rule.detector.id,
    detectorVersion: rule.detector.version,
    bindingId: rule.binding.id,
    bindingDigest: bindingDigest(materialBinding(rule)),
  });
}
