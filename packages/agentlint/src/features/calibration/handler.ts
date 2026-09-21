import { Effect, FileSystem, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import { CalibrationCommand } from "./request.js";
import { CalibrationReport, summarizeCalibration } from "./report.js";

export const calibrationHandler = Effect.fn("calibrationHandler")(function* (command: CalibrationCommand) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const reports: CalibrationReport[] = [];
  for (const file of command.files) {
    const content = yield* fs.readFileString(path.resolve(env.cwd, file));
    reports.push(yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CalibrationReport))(content));
  }
  return summarizeCalibration(reports);
});
