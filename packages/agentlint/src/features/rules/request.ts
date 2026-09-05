/** Rule command contracts. @module @since 0.2.0 */

import { Schema } from "effect";
import { FindingRecord } from "../../domain/finding.js";

export class RulesListCommand extends Schema.TaggedClass<RulesListCommand>()("RulesListCommand", {
  file: Schema.UndefinedOr(Schema.String),
}) {}

export const RuleListItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  standardId: Schema.String,
  lifecycle: Schema.Literals(["state", "change"]),
  authority: Schema.Literals(["agent", "human"]),
  detector: Schema.String,
  enabled: Schema.Boolean,
});
export type RuleListItem = Schema.Schema.Type<typeof RuleListItem>;

export class RulesListResult extends Schema.TaggedClass<RulesListResult>()("RulesListResult", {
  rules: Schema.Array(RuleListItem),
}) {}

export class RulesTestCommand extends Schema.TaggedClass<RulesTestCommand>()("RulesTestCommand", {
  rules: Schema.Array(Schema.String),
}) {}

export class RulesTestResult extends Schema.TaggedClass<RulesTestResult>()("RulesTestResult", {
  message: Schema.String,
  exitCode: Schema.Number,
}) {}

export class RulesScanCommand extends Schema.TaggedClass<RulesScanCommand>()("RulesScanCommand", {
  rules: Schema.Array(Schema.String),
  base: Schema.UndefinedOr(Schema.String),
  files: Schema.Array(Schema.String),
}) {}

export class RulesScanResult extends Schema.TaggedClass<RulesScanResult>()("RulesScanResult", {
  findings: Schema.Array(FindingRecord),
  fixtureMessage: Schema.String,
  exitCode: Schema.Number,
}) {}
