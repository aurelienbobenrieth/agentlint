/**
 * Shared CLI result and review-session effects. @module
 */

import { Console, Effect } from "effect";
import { Env } from "../config/env.js";
import type { AcceptancesResult } from "../features/acceptances/request.js";
import { runReviewSession } from "../features/review/server.js";

export const setExitCode = (code: number) => Effect.map(Env, (env) => env.setExitCode(code));

export const openReviewSession = Effect.fn("openReviewSession")(function* (
  options: Parameters<typeof runReviewSession>[0],
) {
  const result = yield* runReviewSession(options);
  yield* Console.log(`Review finished: ${result.summary}`);
  if (result.feedback) yield* Console.log(result.feedback);
});

export const printAcceptances = Effect.fn("printAcceptances")(function* (result: AcceptancesResult) {
  if (!result.records.length) yield* Console.log("No active acceptances.");
  for (const record of result.records) {
    yield* Console.log(
      `${record.source.bindingId} ${record.authority} ${record.fingerprint.digest.slice(0, 12)} ${record.reason}`,
    );
  }
  yield* setExitCode(result.exitCode);
});
