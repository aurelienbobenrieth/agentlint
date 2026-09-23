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
    readonly reviewEpoch?: number | undefined;
    readonly include?: ReadonlyArray<string> | undefined;
    readonly exclude?: ReadonlyArray<string> | undefined;
    readonly dependencies?: ReadonlyArray<string> | undefined;
    readonly options?: CanonicalValue | undefined;
  };
}

function materialBinding(rule: IdentityRule): CanonicalValue {
  return {
    // Present only when set, so bindings without an epoch keep the digest they had before epochs existed.
    ...(rule.binding.reviewEpoch === undefined ? {} : { reviewEpoch: rule.binding.reviewEpoch }),
    include: [...(rule.binding.include ?? [])],
    exclude: [...(rule.binding.exclude ?? [])],
    // Set semantics come from `bindingDigest`, which orders routing fields by code unit.
    dependencies: [...(rule.binding.dependencies ?? [])],
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
    ...(rule.binding.reviewEpoch === undefined ? {} : { reviewEpoch: rule.binding.reviewEpoch }),
  });
}
