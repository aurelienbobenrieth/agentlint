import { Schema } from "effect";

export class ResolveCommand extends Schema.TaggedClass<ResolveCommand>()("ResolveCommand", {
  selector: Schema.UndefinedOr(Schema.String),
  status: Schema.UndefinedOr(Schema.Literals(["accepted", "deferred", "no_fix"])),
  reason: Schema.UndefinedOr(Schema.String),
  actor: Schema.UndefinedOr(Schema.String),
  interactive: Schema.Boolean,
}) {}

export class ResolveResult extends Schema.TaggedClass<ResolveResult>()("ResolveResult", {
  message: Schema.String,
  exitCode: Schema.Number,
}) {}
