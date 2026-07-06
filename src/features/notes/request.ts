import { Schema } from "effect";

export class NotesListCommand extends Schema.TaggedClass<NotesListCommand>()("NotesListCommand", {}) {}

export class NotesListResult extends Schema.TaggedClass<NotesListResult>()("NotesListResult", {
  message: Schema.String,
  exitCode: Schema.Number,
}) {}
