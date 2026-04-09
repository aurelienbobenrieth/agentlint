/**
 * @module
 * @since 0.1.0
 */

import { Effect } from "effect";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { ListCommand, ListResult } from "./request.js";

/** @since 0.1.0 */
export const listHandler = Effect.fn("listHandler")(function* (_command: ListCommand) {
  const configLoader = yield* ConfigLoader;
  const config = yield* configLoader.load();

  const rules = Object.entries(config.rules).map(([name, rule]) => ({
    name,
    description: rule.meta.description,
    languages: rule.meta.languages,
    include: rule.meta.include,
    ignore: rule.meta.ignore,
  }));

  return new ListResult({ rules });
});
