/**
 * Stable identities for findings and repository bindings.
 *
 * @module
 * @since 0.2.0
 */

import { createHash } from "node:crypto";
import { Schema } from "effect";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const PositiveInteger = Schema.Int.check(Schema.isGreaterThan(0));

/** JSON data accepted by the canonical fingerprint encoder. */
export type CanonicalValue = null | boolean | number | string | ReadonlyArray<CanonicalValue> | CanonicalObject;

/** A canonical JSON object. */
export interface CanonicalObject {
  readonly [key: string]: CanonicalValue;
}

/** The rule components that produced a finding. */
export class FindingSource extends Schema.Class<FindingSource>("FindingSource")({
  standardId: NonEmptyString,
  standardRevision: PositiveInteger,
  detectorId: NonEmptyString,
  detectorVersion: PositiveInteger,
  bindingId: NonEmptyString,
  bindingDigest: NonEmptyString,
}) {}

/** A versioned digest of material finding evidence. */
export class Fingerprint extends Schema.Class<Fingerprint>("Fingerprint")({
  scheme: NonEmptyString,
  version: PositiveInteger,
  digest: NonEmptyString,
}) {}

/** A canonicalization failure. */
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
  /** A detector-owned structural position. It must not be a source line. */
  readonly occurrence: string;
}

export interface ChangeFingerprintEvidence {
  readonly before: CanonicalValue;
  readonly after: CanonicalValue;
  readonly beforePath: string;
  readonly afterPath: string;
  readonly operation: "add" | "delete" | "modify" | "rename";
  /** A detector-owned structural position. It must not be a source line. */
  readonly occurrence: string;
  readonly captures?: CanonicalObject;
}

function encode(value: unknown, ancestors: ReadonlySet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new FingerprintError({ reason: "invalid_value", detail: "numbers must be finite" });
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new FingerprintError({
      reason: "invalid_value",
      detail: `${typeof value} is not canonical JSON data`,
    });
  }
  if (ancestors.has(value)) {
    throw new FingerprintError({ reason: "invalid_value", detail: "canonical JSON data cannot contain cycles" });
  }

  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    return `[${Array.from(value, (entry) => encode(entry, nextAncestors)).join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new FingerprintError({ reason: "invalid_value", detail: "only plain objects can be canonicalized" });
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).toSorted();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(object[key], nextAncestors)}`).join(",")}}`;
}

/** Encode JSON data with stable object key ordering, preserving exact Unicode values. */
export function canonicalStringify(value: CanonicalValue): string {
  return encode(value, new Set());
}

/** Create a full SHA-256 digest for canonical JSON data. */
export function canonicalDigest(value: CanonicalValue): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

/** Normalize a repository-relative path without hiding moves or case changes. */
export function normalizeRepositoryPath(input: string): string {
  const value = input.replaceAll("\\", "/");
  if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) {
    throw new FingerprintError({ reason: "invalid_path", detail: `path must be repository-relative: ${input}` });
  }

  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new FingerprintError({ reason: "invalid_path", detail: `path escapes the repository: ${input}` });
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0) {
    throw new FingerprintError({ reason: "invalid_path", detail: "path must identify a repository file" });
  }
  return parts.join("/");
}

/** Only top-level routing fields are sets. Arbitrary detector options preserve all array order. */
export function canonicalizeBindingConfig(materialConfig: CanonicalValue): CanonicalValue {
  if (materialConfig === null || typeof materialConfig !== "object" || Array.isArray(materialConfig))
    return materialConfig;
  return Object.fromEntries(
    Object.entries(materialConfig).map(([key, value]) => [
      key,
      ["include", "exclude", "dependencies"].includes(key) && Array.isArray(value)
        ? [...new Map(value.map((entry) => [canonicalStringify(entry), entry])).entries()]
            .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([, entry]) => entry)
        : value,
    ]),
  );
}

/** Calculate the material digest of a binding configuration. */
export function bindingDigest(materialConfig: CanonicalValue): string {
  return canonicalDigest({ kind: "agentlint-binding", materialConfig: canonicalizeBindingConfig(materialConfig) });
}

/** Create a versioned fingerprint from already normalized evidence. */
export function createFingerprint(scheme: string, version: number, evidence: CanonicalValue): Fingerprint {
  return new Fingerprint({ scheme, version, digest: canonicalDigest(evidence) });
}

/** Fingerprint semantic state evidence. Presentation positions are excluded. */
export function fingerprintState(evidence: StateFingerprintEvidence): Fingerprint {
  return createFingerprint("source-structure", 2, {
    path: normalizeRepositoryPath(evidence.path),
    structure: evidence.structure,
    captures: evidence.captures ?? {},
    occurrence: evidence.occurrence,
  });
}

/** Fingerprint a semantic comparison without using commit identifiers. */
export function fingerprintChange(evidence: ChangeFingerprintEvidence): Fingerprint {
  return createFingerprint("git-change", 2, {
    before: evidence.before,
    after: evidence.after,
    beforePath: normalizeRepositoryPath(evidence.beforePath),
    afterPath: normalizeRepositoryPath(evidence.afterPath),
    operation: evidence.operation,
    occurrence: evidence.occurrence,
    captures: evidence.captures ?? {},
  });
}

/** Compare every source compatibility field. */
export function sameFindingSource(left: FindingSource, right: FindingSource): boolean {
  return (
    left.standardId === right.standardId &&
    left.standardRevision === right.standardRevision &&
    left.detectorId === right.detectorId &&
    left.detectorVersion === right.detectorVersion &&
    left.bindingId === right.bindingId &&
    left.bindingDigest === right.bindingDigest
  );
}

/** Compare the scheme, algorithm version, and digest. */
export function sameFingerprint(left: Fingerprint, right: Fingerprint): boolean {
  return left.scheme === right.scheme && left.version === right.version && left.digest === right.digest;
}

/** Check whether the engine knows the canonical evidence contract. */
export function isSupportedFingerprint(fingerprint: Fingerprint): boolean {
  return (
    (fingerprint.scheme === "source-structure" && fingerprint.version === 2) ||
    (fingerprint.scheme === "git-change" && fingerprint.version === 2)
  );
}

/** A deterministic key for one exact finding identity. */
export function findingIdentityKey(source: FindingSource, fingerprint: Fingerprint): string {
  return canonicalStringify({
    source: {
      standardId: source.standardId,
      standardRevision: source.standardRevision,
      detectorId: source.detectorId,
      detectorVersion: source.detectorVersion,
      bindingId: source.bindingId,
      bindingDigest: source.bindingDigest,
    },
    fingerprint: {
      scheme: fingerprint.scheme,
      version: fingerprint.version,
      digest: fingerprint.digest,
    },
  });
}
