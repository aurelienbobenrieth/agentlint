/**
 * Stable identities for findings and repository bindings.
 *
 * @module
 * @since 0.2.0
 */

import { createHash } from "node:crypto";
import { Array as A, Result, Schema } from "effect";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const encodeString = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.String));
const encodeNumber = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Number));
const isString = Schema.is(Schema.String);
const isBoolean = Schema.is(Schema.Boolean);
const isNumber = Schema.is(Schema.Number);
const isCanonicalObject = (value: CanonicalValue): value is CanonicalObject =>
  Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value);

/**
 * JSON data accepted by the canonical fingerprint encoder.
 */
export type CanonicalValue = null | boolean | number | string | ReadonlyArray<CanonicalValue> | CanonicalObject;

/**
 * A canonical JSON object.
 */
export interface CanonicalObject {
  readonly [key: string]: CanonicalValue;
}

/**
 * The rule components that produced a finding.
 */
export class FindingSource extends Schema.Class<FindingSource>("FindingSource")({
  standardId: NonEmptyString,
  standardRevision: PositiveInteger,
  detectorId: NonEmptyString,
  detectorVersion: PositiveInteger,
  bindingId: NonEmptyString,
  bindingDigest: NonEmptyString,
  reviewEpoch: Schema.optional(PositiveInteger),
}) {}

/**
 * A versioned digest of material finding evidence.
 */
export class Fingerprint extends Schema.Class<Fingerprint>("Fingerprint")({
  scheme: NonEmptyString,
  version: PositiveInteger,
  digest: NonEmptyString,
}) {}

/**
 * A canonicalization failure: the value is not canonical JSON data, or the path is not repository-relative.
 *
 * @since 0.2.0
 * @category Errors
 */
export class FingerprintError extends Schema.TaggedError<FingerprintError>()("agentlint/FingerprintError", {
  reason: Schema.Literals(["invalid_value", "invalid_path"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `Cannot create fingerprint: ${this.detail}`;
  }
}

export interface StateFingerprintEvidence {
  readonly path: string;
  readonly structure: CanonicalValue;
  readonly captures?: CanonicalObject;
  /**
   * A detector-owned structural position. It must not be a source line.
   */
  readonly occurrence: string;
}

export interface ChangeFingerprintEvidence {
  readonly before: CanonicalValue;
  readonly after: CanonicalValue;
  readonly beforePath: string;
  readonly afterPath: string;
  readonly operation: "add" | "delete" | "modify" | "rename";
  /**
   * A detector-owned structural position. It must not be a source line.
   */
  readonly occurrence: string;
  readonly captures?: CanonicalObject;
}

function encode({ value, ancestors }: { readonly value: unknown; readonly ancestors: ReadonlySet<object> }): string {
  if (value === null) return "null";
  if (isString(value)) return encodeString(value);
  if (isBoolean(value)) return value ? "true" : "false";
  if (isNumber(value)) {
    if (!Number.isFinite(value)) {
      throw new FingerprintError({ reason: "invalid_value", detail: "numbers must be finite" });
    }
    return Object.is(value, -0) ? "0" : encodeNumber(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new FingerprintError({ reason: "invalid_value", detail: "canonical JSON data cannot contain cycles" });
    }
    const nextAncestors = new Set(ancestors).add(value);
    return `[${Array.from(value, (entry) => encode({ value: entry, ancestors: nextAncestors })).join(",")}]`;
  }
  if (!Schema.is(Schema.Record(Schema.String, Schema.Unknown))(value)) {
    throw new FingerprintError({
      reason: "invalid_value",
      detail: "the value is not canonical JSON data",
    });
  }
  if (ancestors.has(value)) {
    throw new FingerprintError({ reason: "invalid_value", detail: "canonical JSON data cannot contain cycles" });
  }

  const nextAncestors = new Set(ancestors).add(value);

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FingerprintError({ reason: "invalid_value", detail: "only plain objects can be canonicalized" });
  }

  const keys = Object.keys(value).toSorted();
  return `{${keys.map((key) => `${encodeString(key)}:${encode({ value: value[key], ancestors: nextAncestors })}`).join(",")}}`;
}

/**
 * Encode JSON data with stable object key ordering, preserving exact Unicode values.
 *
 * The recursive encoder throws internally; this is the only place its failure leaves the module, as a typed value.
 */
export function canonicalJson(value: unknown): Result.Result<string, FingerprintError> {
  return Result.try({
    try: () => encode({ value, ancestors: new Set() }),
    catch: (cause) =>
      cause instanceof FingerprintError
        ? cause
        : new FingerprintError({ reason: "invalid_value", detail: String(cause) }),
  });
}

/**
 * Encode JSON data with stable object key ordering. Throws `FingerprintError` for values the type system cannot rule
 * out (non-finite numbers, cycles, class instances); use `canonicalJson` where the input is not already trusted.
 */
export function canonicalStringify(value: CanonicalValue): string {
  return Result.getOrThrow(canonicalJson(value));
}

/**
 * Create a full SHA-256 digest for canonical JSON data.
 */
export function canonicalDigest(value: CanonicalValue): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

/**
 * Normalize a repository-relative path without hiding moves or case changes.
 */
export function repositoryPath(input: string): Result.Result<string, FingerprintError> {
  const invalid = (detail: string) => Result.fail(new FingerprintError({ reason: "invalid_path", detail }));
  const value = input.replaceAll("\\", "/");
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return invalid(`path must be repository-relative: ${input}`);

  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return invalid(`path escapes the repository: ${input}`);
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0) return invalid("path must identify a repository file");
  return Result.succeed(parts.join("/"));
}

/**
 * Normalize a repository-relative path. Throws `FingerprintError`; use `repositoryPath` for a typed result.
 */
export function normalizeRepositoryPath(input: string): string {
  return Result.getOrThrow(repositoryPath(input));
}

/**
 * Only top-level routing fields are sets. Arbitrary detector options preserve all array order.
 */
function canonicalizeBindingConfig(materialConfig: CanonicalValue): CanonicalValue {
  if (!isCanonicalObject(materialConfig)) return materialConfig;
  return Object.fromEntries(
    Object.entries(materialConfig).map(([key, value]) => [
      key,
      A.contains(["include", "exclude", "dependencies"], key) && Array.isArray(value)
        ? [...new Map(value.map((entry) => [canonicalStringify(entry), entry])).entries()]
            .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([, entry]) => entry)
        : value,
    ]),
  );
}

/**
 * Calculate the material digest of a binding configuration.
 */
export function bindingDigest(materialConfig: CanonicalValue): string {
  return canonicalDigest({
    kind: "agentlint-binding",
    materialConfig: canonicalizeBindingConfig(materialConfig),
  });
}

/**
 * Create a versioned fingerprint from already normalized evidence.
 */
function createFingerprint({
  scheme,
  version,
  evidence,
}: {
  readonly scheme: string;
  readonly version: number;
  readonly evidence: CanonicalValue;
}): Fingerprint {
  return new Fingerprint({ scheme, version, digest: canonicalDigest(evidence) });
}

/**
 * Fingerprint semantic state evidence. Presentation positions are excluded.
 */
export function fingerprintState(evidence: StateFingerprintEvidence): Fingerprint {
  return createFingerprint({
    scheme: "source-structure",
    version: 3,
    evidence: {
      path: normalizeRepositoryPath(evidence.path),
      structure: evidence.structure,
      captures: evidence.captures ?? {},
      occurrence: evidence.occurrence,
    },
  });
}

/**
 * Fingerprint a semantic comparison without using commit identifiers.
 */
export function fingerprintChange(evidence: ChangeFingerprintEvidence): Fingerprint {
  return createFingerprint({
    scheme: "git-change",
    version: 2,
    evidence: {
      before: evidence.before,
      after: evidence.after,
      beforePath: normalizeRepositoryPath(evidence.beforePath),
      afterPath: normalizeRepositoryPath(evidence.afterPath),
      operation: evidence.operation,
      occurrence: evidence.occurrence,
      captures: evidence.captures ?? {},
    },
  });
}

/**
 * Compare every source compatibility field.
 */
export function sameFindingSource({
  left,
  right,
}: {
  readonly left: FindingSource;
  readonly right: FindingSource;
}): boolean {
  return (
    left.standardId === right.standardId &&
    left.standardRevision === right.standardRevision &&
    left.detectorId === right.detectorId &&
    left.detectorVersion === right.detectorVersion &&
    left.bindingId === right.bindingId &&
    left.bindingDigest === right.bindingDigest &&
    left.reviewEpoch === right.reviewEpoch
  );
}

/**
 * Compare the scheme, algorithm version, and digest.
 */
export function sameFingerprint({ left, right }: { readonly left: Fingerprint; readonly right: Fingerprint }): boolean {
  return left.scheme === right.scheme && left.version === right.version && left.digest === right.digest;
}

/**
 * Check whether the engine knows the canonical evidence contract.
 */
export function isSupportedFingerprint(fingerprint: Fingerprint): boolean {
  return (
    (fingerprint.scheme === "source-structure" && fingerprint.version === 3) ||
    (fingerprint.scheme === "git-change" && fingerprint.version === 2)
  );
}

/**
 * A deterministic key for one exact finding identity.
 */
export function findingIdentityKey({
  source,
  fingerprint,
}: {
  readonly source: FindingSource;
  readonly fingerprint: Fingerprint;
}): string {
  return canonicalStringify({
    source: {
      standardId: source.standardId,
      standardRevision: source.standardRevision,
      detectorId: source.detectorId,
      detectorVersion: source.detectorVersion,
      bindingId: source.bindingId,
      bindingDigest: source.bindingDigest,
      ...(source.reviewEpoch === undefined ? {} : { reviewEpoch: source.reviewEpoch }),
    },
    fingerprint: {
      scheme: fingerprint.scheme,
      version: fingerprint.version,
      digest: fingerprint.digest,
    },
  });
}
