/**
 * Finding data contracts.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";
import { Authority } from "./acceptance.js";
import { Fingerprint, FindingSource, findingIdentityKey } from "./fingerprint.js";
import type { AgentlintNode } from "./node.js";

export interface FindingOptions {
  readonly node: AgentlintNode;
  readonly message: string;
}

/** One deterministic review point. */
export class FindingRecord extends Schema.Class<FindingRecord>("FindingRecord")({
  selector: Schema.UndefinedOr(Schema.String),
  ruleId: Schema.String,
  lifecycle: Schema.Literals(["state", "change"]),
  authority: Authority,
  source: FindingSource,
  fingerprint: Fingerprint,
  lineageKey: Schema.UndefinedOr(Schema.String),
  file: Schema.String,
  absolutePath: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  endLine: Schema.Number,
  endColumn: Schema.Number,
  message: Schema.String,
  sourceSnippet: Schema.String,
}) {}

/** Return the exact compatibility key of a finding. */
export function findingKey(finding: Pick<FindingRecord, "source" | "fingerprint">): string {
  return findingIdentityKey(finding.source, finding.fingerprint);
}

/** Add a run-local display selector without changing finding identity. */
export function withSelector(finding: FindingRecord, selector: string): FindingRecord {
  return new FindingRecord({ ...finding, selector });
}
