/**
 * Finding data contracts.
 *
 * A finding is one concrete instance of a deterministic trigger. The `hash`
 * is used by machine output and the ledger; selectors are short display
 * conveniences assigned by the latest check run.
 *
 * @module
 * @since 0.2.0
 */

import { Schema } from "effect";
import type { AgentlintNode } from "./node.js";

export interface FindingOptions {
  readonly node: AgentlintNode;
  readonly message: string;
}

export class FindingRecord extends Schema.Class<FindingRecord>("FindingRecord")({
  selector: Schema.UndefinedOr(Schema.String),
  ruleId: Schema.String,
  file: Schema.String,
  absolutePath: Schema.String,
  nodeType: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  message: Schema.String,
  sourceSnippet: Schema.String,
  hash: Schema.String,
}) {}

export function withSelector(finding: FindingRecord, selector: string): FindingRecord {
  return new FindingRecord({
    selector,
    ruleId: finding.ruleId,
    file: finding.file,
    absolutePath: finding.absolutePath,
    nodeType: finding.nodeType,
    line: finding.line,
    column: finding.column,
    message: finding.message,
    sourceSnippet: finding.sourceSnippet,
    hash: finding.hash,
  });
}
