/**
 * @module
 * @since 0.1.0
 */

import { Effect, HashSet } from "effect";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { StateStore } from "../../shared/infrastructure/state-store.js";
import { collectFlags } from "../../shared/pipeline/collect-flags.js";
import { CheckCommand, CheckResult } from "./request.js";

/** @since 0.1.0 */
export const checkHandler = Effect.fn("checkHandler")(function* (command: CheckCommand) {
  const configLoader = yield* ConfigLoader;
  const stateStore = yield* StateStore;

  const config = yield* configLoader.load();
  const availableRules = Object.keys(config.rules);

  const result = yield* collectFlags({
    all: command.all,
    rules: command.rules,
    dryRun: command.dryRun,
    base: command.base,
    files: command.files,
  });

  if (result.noMatchingRules) {
    return new CheckResult({
      flags: [],
      totalFlags: 0,
      filteredCount: 0,
      noMatchingRules: true,
      availableRules,
    });
  }

  const allFlags = result.flags;

  if (allFlags.length === 0) {
    return new CheckResult({
      flags: [],
      totalFlags: 0,
      filteredCount: 0,
      noMatchingRules: false,
      availableRules,
    });
  }

  const reviewed = yield* stateStore.load();
  const reviewedSize = HashSet.size(reviewed);
  const filteredCount = reviewedSize > 0 ? allFlags.filter((f) => HashSet.has(reviewed, f.hash)).length : 0;
  const unreviewedFlags = reviewedSize > 0 ? allFlags.filter((f) => !HashSet.has(reviewed, f.hash)) : allFlags;

  return new CheckResult({
    flags: unreviewedFlags,
    totalFlags: allFlags.length,
    filteredCount,
    noMatchingRules: false,
    availableRules,
  });
});
