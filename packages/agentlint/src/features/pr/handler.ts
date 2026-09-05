/**
 * Download the review artifact a pull request's agentlint action uploaded.
 *
 * The artifact is named `agentlint-review-<number>` and holds one
 * `agentlint-review.json`. Both the ZIP and the extracted JSON land under
 * `.agentlint/.cache/pr-<number>/`, which is disposable.
 *
 * @module
 * @since 0.2.0
 */

import { Effect, FileSystem, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import { Gh, type GhError } from "../../shared/infrastructure/gh.js";
import { ReviewArtifact } from "../review/contract.js";
import { PrCommand, PrError, PrResult } from "./request.js";
import { readZipEntry } from "./zip.js";

const ARTIFACT_ENTRY = "agentlint-review.json";

const ArtifactListing = Schema.Struct({
  artifacts: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      name: Schema.String,
      expired: Schema.Boolean,
      created_at: Schema.String,
    }),
  ),
});
const decodeArtifactListing = Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactListing));
const decodeReviewArtifact = Schema.decodeUnknownEffect(Schema.fromJsonString(ReviewArtifact));

/** Artifact name the GitHub action uploads for a pull request. */
export const artifactName = (number: number): string => `agentlint-review-${number}`;

export const prHandler = Effect.fn("prHandler")(function* (command: PrCommand) {
  const gh = yield* Gh;
  const env = yield* Env;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { number } = command;

  const ghFailure = (repo: string | undefined) => (error: GhError) =>
    new PrError({
      reason: error.reason === "missing" ? "gh_missing" : "gh_failed",
      number,
      repo,
      detail: error.detail,
    });

  const repo =
    command.repo ??
    (yield* gh.text(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).pipe(
      Effect.mapError(ghFailure(undefined)),
      Effect.map((value) => value.trim()),
    ));

  const name = artifactName(number);
  const listing = yield* gh.text(["api", `repos/${repo}/actions/artifacts?name=${name}&per_page=5`]).pipe(
    Effect.mapError(ghFailure(repo)),
    Effect.flatMap((raw) =>
      decodeArtifactListing(raw).pipe(
        Effect.mapError((cause) => new PrError({ reason: "gh_failed", number, repo, detail: cause.message })),
      ),
    ),
  );

  const newest = listing.artifacts
    .filter((artifact) => artifact.name === name && !artifact.expired)
    .toSorted((left, right) => right.created_at.localeCompare(left.created_at))[0];
  if (!newest) return yield* new PrError({ reason: "no_artifact", number, repo });

  const zip = yield* gh
    .binary(["api", `repos/${repo}/actions/artifacts/${newest.id}/zip`])
    .pipe(Effect.mapError(ghFailure(repo)));

  const cacheDir = path.resolve(env.cwd, ".agentlint", ".cache", `pr-${number}`);
  yield* fs.makeDirectory(cacheDir, { recursive: true });
  yield* fs.writeFile(path.join(cacheDir, "agentlint-review.zip"), zip);

  const invalid = (detail: string) => new PrError({ reason: "invalid_artifact", number, repo, detail });
  const json = yield* Effect.try({
    try: () => readZipEntry(zip, ARTIFACT_ENTRY),
    catch: (error) => invalid(error instanceof Error ? error.message : String(error)),
  });
  const artifactPath = path.join(cacheDir, ARTIFACT_ENTRY);
  yield* fs.writeFile(artifactPath, json);

  const artifact = yield* decodeReviewArtifact(Buffer.from(json).toString("utf8")).pipe(
    Effect.mapError((cause) => invalid(cause.message)),
  );

  return new PrResult({ repo, artifactId: newest.id, artifactPath, artifact });
});
