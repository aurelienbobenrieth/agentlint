import { Schema } from "effect";

export class ExplainCommand extends Schema.TaggedClass<ExplainCommand>()("ExplainCommand", {
  selector: Schema.String,
}) {}

export class ExplainResult extends Schema.TaggedClass<ExplainResult>()("ExplainResult", {
  output: Schema.String,
  found: Schema.Boolean,
}) {}
