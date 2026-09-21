// @ts-check
/**
 * The subset of the `@aurelienbbn/agentlint/contract` review artifact that the action reads. Decoded structurally: the
 * The Effect schemas below validate untrusted artifact fields at the file boundary.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Array as A, Schema } from "effect";

const isRecordValue = Schema.is(Schema.Record(Schema.String, Schema.Unknown));
const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);

/**
 * @typedef {object} Proposal
 * @property {string} summary
 * @property {string | null} diff
 * @property {string} actor
 * @property {string} at
 */

/**
 * @typedef {object} Acceptance
 * @property {string} reason
 * @property {string} actor
 * @property {string} at
 */

/**
 * @typedef {object} Guidance
 * @property {string} standard
 * @property {ReadonlyArray<string>} checks
 */

/**
 * @typedef {object} Finding
 * @property {string} id
 * @property {string} digest
 * @property {string} ruleId
 * @property {string} ruleTitle
 * @property {"state" | "change"} lifecycle
 * @property {"agent" | "human"} authority
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {string} message
 * @property {Guidance} guidance
 * @property {"unresolved" | "accepted" | "changes_requested"} status
 * @property {Acceptance | null} acceptance
 * @property {string | null} lineageReason
 * @property {Proposal | null} proposal
 */

/**
 * @typedef {object} Artifact
 * @property {string} project
 * @property {string} base
 * @property {ReadonlyArray<Finding>} findings
 */

class ArtifactError extends Error {
  /**
   * @param {object} input
   * @param {string} input.path
   * @param {string} input.detail
   */
  constructor({ path, detail }) {
    super(`Review artifact ${path} is not readable: ${detail}`);
    this.name = "ArtifactError";
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return isRecordValue(value);
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.record
 * @param {string} input.key
 * @returns {string}
 */
function stringAt({ record, key }) {
  const value = record[key];
  if (!isString(value)) throw new TypeError(`expected string at ${key}`);
  return value;
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.record
 * @param {string} input.key
 * @returns {number}
 */
function numberAt({ record, key }) {
  const value = record[key];
  if (!isNumber(value)) throw new TypeError(`expected number at ${key}`);
  return value;
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.record
 * @param {string} input.key
 * @returns {string | null}
 */
function nullableStringAt({ record, key }) {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (!isString(value)) throw new TypeError(`expected string or null at ${key}`);
  return value;
}

/**
 * @param {object} input
 * @param {Record<string, unknown>} input.record
 * @param {string} input.key
 * @returns {Record<string, unknown>}
 */
function recordAt({ record, key }) {
  const value = record[key];
  if (!isRecord(value)) throw new TypeError(`expected object at ${key}`);
  return value;
}

/**
 * @template T
 * @param {object} input
 * @param {string} input.key
 * @param {ReadonlyArray<T>} input.allowed
 * @param {unknown} input.value
 * @returns {T}
 */
function oneOf({ key, allowed, value }) {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new TypeError(`unexpected value at ${key}: ${String(value)}`);
  return match;
}

/**
 * @param {unknown} raw
 * @returns {Finding}
 */
function decodeFinding(raw) {
  if (!isRecord(raw)) throw new TypeError("finding is not an object");
  const identity = recordAt({ record: raw, key: "identity" });
  recordAt({ record: identity, key: "fingerprint" });
  const guidance = recordAt({ record: raw, key: "guidance" });
  const checks = guidance["checks"];
  const acceptance = raw["acceptance"];
  const proposal = raw["proposal"];
  return {
    id: stringAt({ record: raw, key: "id" }),
    digest: createHash("sha256")
      .update(stringAt({ record: raw, key: "id" }))
      .digest("hex"),
    ruleId: stringAt({ record: raw, key: "ruleId" }),
    ruleTitle: stringAt({ record: raw, key: "ruleTitle" }),
    lifecycle: oneOf({ key: "lifecycle", allowed: ["state", "change"], value: raw["lifecycle"] }),
    authority: oneOf({ key: "authority", allowed: ["agent", "human"], value: raw["authority"] }),
    file: stringAt({ record: raw, key: "file" }),
    line: numberAt({ record: raw, key: "line" }),
    column: numberAt({ record: raw, key: "column" }),
    message: stringAt({ record: raw, key: "message" }),
    guidance: {
      standard: stringAt({ record: guidance, key: "standard" }),
      checks: Array.isArray(checks) ? A.filter(checks, isString) : [],
    },
    status: oneOf({ key: "status", allowed: ["unresolved", "accepted", "changes_requested"], value: raw["status"] }),
    acceptance: isRecord(acceptance)
      ? {
          reason: stringAt({ record: acceptance, key: "reason" }),
          actor: stringAt({ record: acceptance, key: "actor" }),
          at: stringAt({ record: acceptance, key: "at" }),
        }
      : null,
    lineageReason: nullableStringAt({ record: raw, key: "lineageReason" }),
    proposal: isRecord(proposal)
      ? {
          summary: stringAt({ record: proposal, key: "summary" }),
          diff: nullableStringAt({ record: proposal, key: "diff" }),
          actor: stringAt({ record: proposal, key: "actor" }),
          at: stringAt({ record: proposal, key: "at" }),
        }
      : null,
  };
}

/**
 * @param {unknown} raw
 * @returns {Artifact}
 */
export function decodeArtifact(raw) {
  if (!isRecord(raw) || raw["version"] !== 3) throw new TypeError("not a version 3 review artifact");
  const state = recordAt({ record: raw, key: "state" });
  const findings = state["findings"];
  if (!Array.isArray(findings)) throw new TypeError("state.findings is not an array");
  return {
    project: stringAt({ record: state, key: "project" }),
    base: stringAt({ record: state, key: "base" }),
    findings: findings.map(decodeFinding),
  };
}

/**
 * @param {string} path
 * @returns {Promise<Artifact>}
 */
export async function readArtifact(path) {
  const text = await readFile(path, "utf8").catch((error) => {
    throw new ArtifactError({ path, detail: error instanceof Error ? error.message : String(error) });
  });
  try {
    return decodeArtifact(JSON.parse(text));
  } catch (error) {
    throw new ArtifactError({ path, detail: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * @param {Finding} finding
 */
export function shortDigest(finding) {
  return finding.digest.slice(0, 12);
}

/**
 * @param {ReadonlyArray<Finding>} findings
 */
export function unresolved(findings) {
  return findings.filter((finding) => finding.status === "unresolved");
}
