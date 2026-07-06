import { Schema } from "effect";

export class ApproveCommand extends Schema.TaggedClass<ApproveCommand>()("ApproveCommand", {
  selector: Schema.UndefinedOr(Schema.String),
  reason: Schema.UndefinedOr(Schema.String),
  actor: Schema.UndefinedOr(Schema.String),
}) {}

export class ApproveResult extends Schema.TaggedClass<ApproveResult>()("ApproveResult", {
  message: Schema.String,
  exitCode: Schema.Number,
}) {}
