// @ts-check
/**
 * The subset of the `@aurelienbbn/agentlint/contract` review artifact that the
 * action reads. Decoded structurally: the action has no dependency on `effect`.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

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

export class ArtifactError extends Error {
  /** @param {string} path @param {string} detail */
  constructor(path, detail) {
    super(`Review artifact ${path} is not readable: ${detail}`);
    this.name = "ArtifactError";
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @returns {string}
 */
function stringAt(record, key) {
  const value = record[key];
  if (typeof value !== "string") throw new TypeError(`expected string at ${key}`);
  return value;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @returns {number}
 */
function numberAt(record, key) {
  const value = record[key];
  if (typeof value !== "number") throw new TypeError(`expected number at ${key}`);
  return value;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @returns {string | null}
 */
function nullableStringAt(record, key) {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new TypeError(`expected string or null at ${key}`);
  return value;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @returns {Record<string, unknown>}
 */
function recordAt(record, key) {
  const value = record[key];
  if (!isRecord(value)) throw new TypeError(`expected object at ${key}`);
  return value;
}

/**
 * @template T
 * @param {string} key
 * @param {ReadonlyArray<T>} allowed
 * @param {unknown} value
 * @returns {T}
 */
function oneOf(key, allowed, value) {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new TypeError(`unexpected value at ${key}: ${String(value)}`);
  return match;
}

/**
 * @param {unknown} raw
 * @returns {Finding}
 */
export function decodeFinding(raw) {
  if (!isRecord(raw)) throw new TypeError("finding is not an object");
  const identity = recordAt(raw, "identity");
  recordAt(identity, "fingerprint");
  const guidance = recordAt(raw, "guidance");
  const checks = guidance["checks"];
  const acceptance = raw["acceptance"];
  const proposal = raw["proposal"];
  return {
    id: stringAt(raw, "id"),
    digest: createHash("sha256").update(stringAt(raw, "id")).digest("hex"),
    ruleId: stringAt(raw, "ruleId"),
    ruleTitle: stringAt(raw, "ruleTitle"),
    lifecycle: oneOf("lifecycle", ["state", "change"], raw["lifecycle"]),
    authority: oneOf("authority", ["agent", "human"], raw["authority"]),
    file: stringAt(raw, "file"),
    line: numberAt(raw, "line"),
    column: numberAt(raw, "column"),
    message: stringAt(raw, "message"),
    guidance: {
      standard: stringAt(guidance, "standard"),
      checks: Array.isArray(checks) ? checks.filter((check) => typeof check === "string") : [],
    },
    status: oneOf("status", ["unresolved", "accepted", "changes_requested"], raw["status"]),
    acceptance: isRecord(acceptance)
      ? { reason: stringAt(acceptance, "reason"), actor: stringAt(acceptance, "actor"), at: stringAt(acceptance, "at") }
      : null,
    lineageReason: nullableStringAt(raw, "lineageReason"),
    proposal: isRecord(proposal)
      ? {
          summary: stringAt(proposal, "summary"),
          diff: nullableStringAt(proposal, "diff"),
          actor: stringAt(proposal, "actor"),
          at: stringAt(proposal, "at"),
        }
      : null,
  };
}

/**
 * @param {unknown} raw
 * @returns {Artifact}
 */
export function decodeArtifact(raw) {
  if (!isRecord(raw) || raw["version"] !== 2) throw new TypeError("not a version 2 review artifact");
  const state = recordAt(raw, "state");
  const findings = state["findings"];
  if (!Array.isArray(findings)) throw new TypeError("state.findings is not an array");
  return {
    project: stringAt(state, "project"),
    base: stringAt(state, "base"),
    findings: findings.map(decodeFinding),
  };
}

/**
 * @param {string} path
 * @returns {Promise<Artifact>}
 */
export async function readArtifact(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new ArtifactError(path, error instanceof Error ? error.message : String(error));
  }
  try {
    return decodeArtifact(JSON.parse(text));
  } catch (error) {
    throw new ArtifactError(path, error instanceof Error ? error.message : String(error));
  }
}

/** @param {Finding} finding */
export function shortDigest(finding) {
  return finding.digest.slice(0, 12);
}

/** @param {ReadonlyArray<Finding>} findings */
export function unresolved(findings) {
  return findings.filter((finding) => finding.status === "unresolved");
}
