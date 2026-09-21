/**
 * Download the review artifact a pull request's agentlint action uploaded.
 *
 * The artifact is named `agentlint-review-<number>` and holds one `agentlint-review.json`. Both the ZIP and the
 * extracted JSON land under `.agentlint/.cache/pr-<number>/`, which is disposable.
 *
 * @module
 * @since 0.2.0
 */

import { Console, Effect, FileSystem, Path, Schema } from "effect";
import { Env } from "../../config/env.js";
import { compareStrings } from "../../domain/compare.js";
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
      workflow_run: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            head_branch: Schema.optional(Schema.NullOr(Schema.String)),
            head_repository_id: Schema.optional(Schema.NullOr(Schema.Number)),
            head_sha: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
      ),
    }),
  ),
});
const PullHead = Schema.Struct({
  head: Schema.Struct({
    ref: Schema.String,
    sha: Schema.String,
    repo: Schema.NullOr(Schema.Struct({ id: Schema.Number })),
  }),
  base: Schema.Struct({
    repo: Schema.Struct({ id: Schema.Number, default_branch: Schema.String }),
  }),
});
const decodePullHead = Schema.decodeUnknownEffect(Schema.fromJsonString(PullHead));
const decodeArtifactListing = Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactListing));
const decodeReviewArtifact = Schema.decodeUnknownEffect(Schema.fromJsonString(ReviewArtifact));

/**
 * Artifact name the GitHub action uploads for a pull request.
 */
const artifactName = (number: number): string => `agentlint-review-${number}`;

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

  const decodeFailure = (cause: { readonly message: string }) =>
    new PrError({ reason: "gh_failed", number, repo, detail: cause.message });
  const pull = yield* gh.text(["api", `repos/${repo}/pulls/${number}`]).pipe(
    Effect.mapError(ghFailure(repo)),
    Effect.flatMap((raw) => decodePullHead(raw).pipe(Effect.mapError(decodeFailure))),
  );

  const name = artifactName(number);
  const listing = yield* gh.text(["api", `repos/${repo}/actions/artifacts?name=${name}&per_page=100`]).pipe(
    Effect.mapError(ghFailure(repo)),
    Effect.flatMap((raw) => decodeArtifactListing(raw).pipe(Effect.mapError(decodeFailure))),
  );

  // Any workflow run in the repository can upload an artifact under this name, including the run of another pull
  // request from a fork. Two kinds of run are candidates. A `pull_request` run of this pull request's own head
  // repository and branch. And a run of the base repository on its default branch: that is where GitHub runs the
  // `/agentlint` command job (`issue_comment` always uses the default branch's workflow and reports its SHA), which
  // uploads the artifact of the scan it made after an approval. No pull request branch can produce the second kind.
  type Run = (typeof listing.artifacts)[number]["workflow_run"];
  const fromPullHead = (run: Run): boolean =>
    pull.head.repo !== null && run?.head_repository_id === pull.head.repo.id && run.head_branch === pull.head.ref;
  const fromCommandRun = (run: Run): boolean =>
    run?.head_repository_id === pull.base.repo.id &&
    run.head_branch === pull.base.repo.default_branch &&
    run.head_branch !== pull.head.ref;
  const live = listing.artifacts.filter((artifact) => artifact.name === name && !artifact.expired);
  const newestFirst = live
    .filter((artifact) => fromPullHead(artifact.workflow_run) || fromCommandRun(artifact.workflow_run))
    .toSorted((left, right) => compareStrings(right.created_at, left.created_at));
  // The scan of the current head wins. Otherwise the newest candidate is opened, and the reader is told that what it
  // shows may not be the head: an older push, or a command run, whose scanned commit the listing does not report.
  const exact = newestFirst.find(
    (artifact) => fromPullHead(artifact.workflow_run) && artifact.workflow_run?.head_sha === pull.head.sha,
  );
  const newest = exact ?? newestFirst[0];
  if (!newest)
    return yield* new PrError({ reason: live.length > 0 ? "foreign_artifact" : "no_artifact", number, repo });
  const artifactHead = fromPullHead(newest.workflow_run) ? (newest.workflow_run?.head_sha ?? undefined) : undefined;
  if (exact === undefined) {
    yield* Console.error(
      artifactHead === undefined
        ? `agentlint pr: the newest artifact was uploaded by a run that does not report the pull request commit it scanned, such as an /agentlint command run. The pull request head is ${pull.head.sha}; the findings may be older than it.`
        : `agentlint pr: artifact is for ${artifactHead}, pull request head is ${pull.head.sha}. Re-run the gate (/agentlint check) for a current one.`,
    );
  }

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

  return new PrResult({ repo, artifactId: newest.id, artifactPath, artifact, pullHead: pull.head.sha, artifactHead });
});
