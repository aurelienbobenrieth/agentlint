/**
 * Review artifact and detached-decision filesystem adapters. @module
 */

import { Effect, FileSystem, Path, Schema } from "effect";
import { Env } from "../config/env.js";
import type { CheckResult } from "../features/check/request.js";
import { ReviewArtifact } from "../features/review/contract.js";
import { buildReviewPayload } from "../features/review/handler.js";
import { AcceptanceStoreError, parseDecisions } from "../shared/infrastructure/acceptance-store.js";
import { encodePrettyJson } from "../shared/infrastructure/json.js";

export const readArtifact = Effect.fn("readArtifact")(function* (file: string) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(env.cwd, file);
  const raw = yield* fs.readFileString(absolute);
  const artifact = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ReviewArtifact))(raw).pipe(
    Effect.mapError((cause) => new Error(`${file} is not an agentlint review artifact: ${cause.message}`, { cause })),
  );
  return { state: artifact.state, source: absolute };
});

export const writeReviewArtifact = Effect.fn("writeReviewArtifact")(function* (
  file: string,
  check: CheckResult,
  base?: string,
) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.resolve(env.cwd, file);
  const state = yield* buildReviewPayload({
    check,
    base,
    mode: "review",
    transport: "detached",
    source: path.basename(absolute),
  });
  const artifact: ReviewArtifact = { version: 3, state };
  yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
  yield* fs.writeFileString(absolute, `${encodePrettyJson(artifact)}\n`);
  return absolute;
});

export const readAcceptanceRecords = Effect.fn("readAcceptanceRecords")(function* (file: string) {
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const raw = yield* fs.readFileString(path.resolve(env.cwd, file));
  return yield* Effect.try({
    try: () => parseDecisions(raw),
    catch: (error) =>
      Schema.is(AcceptanceStoreError)(error)
        ? error
        : new AcceptanceStoreError({ reason: "invalid_record", detail: "Decision parsing failed", line: undefined }),
  });
});
