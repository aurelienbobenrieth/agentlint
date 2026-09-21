import { Schema } from "effect";

export class CalibrationCommand extends Schema.TaggedClass<CalibrationCommand>()("CalibrationCommand", {
  files: Schema.Array(Schema.String),
}) {}
