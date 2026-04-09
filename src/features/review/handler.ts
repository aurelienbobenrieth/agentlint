/**
 * @module
 * @since 0.1.0
 */

import { Effect } from "effect";
import { StateStore } from "../../shared/infrastructure/state-store.js";
import { collectFlags } from "../../shared/pipeline/collect-flags.js";
import { ReviewCommand, ReviewResult } from "./request.js";

/** @since 0.1.0 */
export const reviewHandler = Effect.fn("reviewHandler")(function* (command: ReviewCommand) {
  const stateStore = yield* StateStore;

  if (command.reset) {
    yield* stateStore.reset();
    return new ReviewResult({ message: "Cleared .agentlint-state" });
  }

  if (command.all) {
    const result = yield* collectFlags({
      all: true,
      rules: [],
      dryRun: false,
      base: undefined,
      files: [],
    });
    const allFlags = result.flags;
    if (allFlags.length === 0) {
      return new ReviewResult({ message: "No flags to review." });
    }
    yield* stateStore.append(allFlags.map((f) => f.hash));
    return new ReviewResult({ message: `Marked ${allFlags.length} flag(s) as reviewed.` });
  }

  if (command.hashes.length > 0) {
    yield* stateStore.append([...command.hashes]);
    return new ReviewResult({ message: `Marked ${command.hashes.length} hash(es) as reviewed.` });
  }

  return new ReviewResult({
    message: [
      "Usage:",
      "  agentlint review <hash...>   Mark specific flags as reviewed",
      "  agentlint review --all       Mark all current flags as reviewed",
      "  agentlint review --reset     Wipe the state file",
    ].join("\n"),
  });
});
