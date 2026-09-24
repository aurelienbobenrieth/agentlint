/**
 * Finding data contracts.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";
import { createHash } from "node:crypto";
import { Fingerprint, FindingSource, findingIdentityKey } from "./fingerprint.js";
import type { AgentlintNode } from "./node.js";
import type { CanonicalValue } from "./fingerprint.js";
import { Lifecycle, RuleAuthority } from "./rule/primitives.js";

/**
 * Evidence reported by a state detector.
 */
export interface FindingOptions {
  readonly node: AgentlintNode;
  readonly message: string;
  /**
   * Additional material judgment evidence. The containing file is always included.
   */
  readonly evidence?: CanonicalValue;
  /**
   * Stable detector-owned occurrence identity, unique within the current file.
   */
  readonly key?: string;
  /**
   * Declared binding dependencies that a reviewer should read with this finding. These paths provide context only;
   * material evidence still belongs in `evidence`.
   */
  readonly relatedFiles?: ReadonlyArray<string>;
}

/**
 * One deterministic review point.
 */
export class FindingRecord extends Schema.Class<FindingRecord>("FindingRecord")({
  selector: Schema.UndefinedOr(Schema.String),
  ruleId: Schema.String,
  lifecycle: Lifecycle,
  authority: RuleAuthority,
  source: FindingSource,
  fingerprint: Fingerprint,
  lineageKey: Schema.UndefinedOr(Schema.String),
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  endLine: Schema.Number,
  endColumn: Schema.Number,
  message: Schema.String,
  sourceSnippet: Schema.String,
  relatedFiles: Schema.optional(Schema.Array(Schema.String)),
}) {}

/**
 * Return the exact compatibility key of a finding.
 */
export function findingKey(finding: Pick<FindingRecord, "source" | "fingerprint">): string {
  return findingIdentityKey({ source: finding.source, fingerprint: finding.fingerprint });
}

/**
 * Compact transport identifier over the complete finding identity.
 */
export function findingId(finding: Pick<FindingRecord, "source" | "fingerprint">): string {
  return createHash("sha256").update(findingKey(finding)).digest("hex");
}

/**
 * Add a run-local display selector without changing finding identity.
 */
export function withSelector({
  finding,
  selector,
}: {
  readonly finding: FindingRecord;
  readonly selector: string;
}): FindingRecord {
  return new FindingRecord({
    selector,
    ruleId: finding.ruleId,
    lifecycle: finding.lifecycle,
    authority: finding.authority,
    source: finding.source,
    fingerprint: finding.fingerprint,
    lineageKey: finding.lineageKey,
    file: finding.file,
    line: finding.line,
    column: finding.column,
    endLine: finding.endLine,
    endColumn: finding.endColumn,
    message: finding.message,
    sourceSnippet: finding.sourceSnippet,
    relatedFiles: finding.relatedFiles,
  });
}
