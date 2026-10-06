/**
 * The change base a check would use. @module
 */

import { Effect } from "effect";
import { Git } from "../../shared/infrastructure/git/service.js";
import { selectBase } from "../../shared/pipeline/base.js";
import { BaseResult, type BaseCommand } from "./request.js";

export const baseHandler = Effect.fn("baseHandler")(function* (command: BaseCommand) {
  const selected = yield* selectBase(command.base);
  const baseline = yield* (yield* Git).baseline(selected?.ref);
  return new BaseResult({ ...baseline, source: selected?.source ?? "default" });
});
