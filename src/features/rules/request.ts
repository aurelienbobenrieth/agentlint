import { Schema } from "effect";

export class RulesListCommand extends Schema.TaggedClass<RulesListCommand>()("RulesListCommand", {
  file: Schema.UndefinedOr(Schema.String),
}) {}

export const RuleListItem = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  persistence: Schema.Literals(["ephemeral", "durable"]),
  standard: Schema.String,
  enabled: Schema.Boolean,
});

export type RuleListItem = Schema.Schema.Type<typeof RuleListItem>;

export class RulesListResult extends Schema.TaggedClass<RulesListResult>()("RulesListResult", {
  rules: Schema.Array(RuleListItem),
}) {}
