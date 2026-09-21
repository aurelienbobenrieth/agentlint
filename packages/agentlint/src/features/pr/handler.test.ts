import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, FileSystem, Layer, Schema } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { writeZip } from "../../__fixtures__/zip.js";
import { Env } from "../../config/env.js";
import { Gh, GhError } from "../../shared/infrastructure/gh.js";
import { ReviewArtifact } from "../review/contract.js";
import { prHandler } from "./handler.js";
import { PrCommand } from "./request.js";

const cwd = join(tmpdir(), "agentlint-v02-pr-test");
const TestEnv = Layer.succeed(
  Env,
  Env.of({ cwd, argv: [], actor: "agent:test", platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
);

const artifact: ReviewArtifact = {
  version: 3,
  state: {
    version: 3,
    sources: {},
    coverage: { scope: "complete", files: [], rules: [] },
    mode: "review",
    transport: "detached",
    project: "demo",
    base: "main",
    generatedAt: "2026-08-29T10:00:00.000Z",
    applications: [],
    findings: [],
    calibration: [],
    detached: { source: "agentlint-review.json" },
  },
};

const HEAD_SHA = "b".repeat(40);
const OLD_SHA = "a".repeat(40);
const ownRun = { head_branch: "feature/gate", head_repository_id: 900, head_sha: OLD_SHA };
const workflowRun = (head_sha: string) => ({ head_branch: "feature/gate", head_repository_id: 900, head_sha });
const pullHead = JSON.stringify({
  head: { ref: "feature/gate", sha: HEAD_SHA, repo: { id: 900 } },
  base: { repo: { id: 900, default_branch: "main" } },
});
const listedArtifacts = [
  { id: 11, name: "agentlint-review-42", expired: true, created_at: "2026-08-30T10:00:00Z", workflow_run: ownRun },
  { id: 12, name: "agentlint-review-42", expired: false, created_at: "2026-08-28T10:00:00Z", workflow_run: ownRun },
  { id: 13, name: "agentlint-review-42", expired: false, created_at: "2026-08-29T10:00:00Z", workflow_run: ownRun },
  // Newer, same name, uploaded by the workflow run of a fork's pull request.
  {
    id: 14,
    name: "agentlint-review-42",
    expired: false,
    created_at: "2026-08-31T10:00:00Z",
    workflow_run: { head_branch: "feature/gate", head_repository_id: 666, head_sha: HEAD_SHA },
  },
];
const listing = JSON.stringify({ artifacts: listedArtifacts });

/**
 * A `Gh` that serves one artifact listing for pull request 42.
 */
const ghWithListing = (artifacts: ReadonlyArray<unknown>, calls: string[][], zip: Uint8Array) =>
  Layer.succeed(
    Gh,
    Gh.of({
      text: (args) => Effect.succeed(args[1]?.endsWith("/pulls/42") ? pullHead : JSON.stringify({ artifacts })),
      binary: (args) => {
        calls.push([...args]);
        return Effect.succeed(zip);
      },
    }),
  );

/**
 * Collects what the handler writes to stderr.
 */
const captureErrors = (lines: string[]) =>
  Effect.provideService(Console.Console, {
    ...globalThis.console,
    error: (...args: ReadonlyArray<unknown>) => {
      lines.push(args.map(String).join(" "));
    },
  } as Console.Console);

const stubGh = (calls: string[][], zip: Uint8Array) =>
  Layer.succeed(
    Gh,
    Gh.of({
      text: (args) => {
        calls.push([...args]);
        if (args[0] === "repo") return Effect.succeed("octo/repo\n");
        if (args[1]?.includes("actions/artifacts?name=")) return Effect.succeed(listing);
        if (args[1]?.endsWith("/pulls/42")) return Effect.succeed(pullHead);
        return Effect.fail(new GhError({ reason: "failed", args: [...args], detail: "unexpected call" }));
      },
      binary: (args) => {
        calls.push([...args]);
        return Effect.succeed(zip);
      },
    }),
  );

const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.provide(NodeServices.layer));

afterEach(() => Effect.runPromise(cleanup));

describe("prHandler", () => {
  it("downloads the newest live artifact of the pull request's own runs, extracts the review JSON, and decodes it", async () => {
    const calls: string[][] = [];
    const zip = writeZip([
      { name: "agentlint-review.json", data: Buffer.from(JSON.stringify(artifact)), method: "deflate" },
    ]);
    const layer = Layer.mergeAll(stubGh(calls, zip), NodeServices.layer).pipe(Layer.provideMerge(TestEnv));

    const result = await Effect.runPromise(
      prHandler(new PrCommand({ number: 42, repo: undefined })).pipe(Effect.provide(layer)),
    );

    expect(result.repo).toBe("octo/repo");
    expect(result.artifactId).toBe(13);
    expect(result.artifactPath).toBe(join(cwd, ".agentlint", ".cache", "pr-42", "agentlint-review.json"));
    expect(result.artifact).toEqual(artifact);
    expect(calls.at(-1)).toEqual(["api", "repos/octo/repo/actions/artifacts/13/zip"]);

    const written = await Effect.runPromise(
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(result.artifactPath)).pipe(
        Effect.provide(NodeServices.layer),
      ),
    );
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(ReviewArtifact))(written)).toEqual(artifact);
  });

  it("prefers the artifact of the pull request head over a newer one of an older push", async () => {
    const calls: string[][] = [];
    const warnings: string[] = [];
    const zip = writeZip([
      { name: "agentlint-review.json", data: Buffer.from(JSON.stringify(artifact)), method: "deflate" },
    ]);
    const artifacts = [
      {
        id: 21,
        name: "agentlint-review-42",
        expired: false,
        created_at: "2026-08-29T10:00:00Z",
        workflow_run: workflowRun(HEAD_SHA),
      },
      // A re-run of the previous push finished later.
      {
        id: 22,
        name: "agentlint-review-42",
        expired: false,
        created_at: "2026-08-30T10:00:00Z",
        workflow_run: workflowRun(OLD_SHA),
      },
    ];
    const layer = Layer.mergeAll(ghWithListing(artifacts, calls, zip), NodeServices.layer).pipe(
      Layer.provideMerge(TestEnv),
    );
    const result = await Effect.runPromise(
      prHandler(new PrCommand({ number: 42, repo: "octo/repo" })).pipe(captureErrors(warnings), Effect.provide(layer)),
    );
    expect(result.artifactId).toBe(21);
    expect(result).toMatchObject({ pullHead: HEAD_SHA, artifactHead: HEAD_SHA });
    expect(warnings).toEqual([]);
  });

  it("falls back to the newest artifact of the branch and says which commit it is for", async () => {
    const calls: string[][] = [];
    const warnings: string[] = [];
    const zip = writeZip([
      { name: "agentlint-review.json", data: Buffer.from(JSON.stringify(artifact)), method: "deflate" },
    ]);
    const layer = Layer.mergeAll(ghWithListing(listedArtifacts, calls, zip), NodeServices.layer).pipe(
      Layer.provideMerge(TestEnv),
    );
    const result = await Effect.runPromise(
      prHandler(new PrCommand({ number: 42, repo: "octo/repo" })).pipe(captureErrors(warnings), Effect.provide(layer)),
    );
    expect(result.artifactId).toBe(13);
    expect(result.artifactHead).toBe(OLD_SHA);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`artifact is for ${OLD_SHA}, pull request head is ${HEAD_SHA}`);
  });

  it("accepts the artifact of a command run on the base repository's default branch, with a warning", async () => {
    const calls: string[][] = [];
    const warnings: string[] = [];
    const zip = writeZip([
      { name: "agentlint-review.json", data: Buffer.from(JSON.stringify(artifact)), method: "deflate" },
    ]);
    const artifacts = [
      { id: 31, name: "agentlint-review-42", expired: false, created_at: "2026-08-29T10:00:00Z", workflow_run: ownRun },
      // issue_comment runs report the default branch and its SHA, never the pull request's.
      {
        id: 32,
        name: "agentlint-review-42",
        expired: false,
        created_at: "2026-08-30T10:00:00Z",
        workflow_run: { head_branch: "main", head_repository_id: 900, head_sha: "c".repeat(40) },
      },
      // Another branch of the same repository, and a fork's default branch, stay foreign.
      {
        id: 33,
        name: "agentlint-review-42",
        expired: false,
        created_at: "2026-08-31T10:00:00Z",
        workflow_run: { head_branch: "other", head_repository_id: 900, head_sha: HEAD_SHA },
      },
      {
        id: 34,
        name: "agentlint-review-42",
        expired: false,
        created_at: "2026-09-01T10:00:00Z",
        workflow_run: { head_branch: "main", head_repository_id: 666, head_sha: HEAD_SHA },
      },
    ];
    const layer = Layer.mergeAll(ghWithListing(artifacts, calls, zip), NodeServices.layer).pipe(
      Layer.provideMerge(TestEnv),
    );
    const result = await Effect.runPromise(
      prHandler(new PrCommand({ number: 42, repo: "octo/repo" })).pipe(captureErrors(warnings), Effect.provide(layer)),
    );
    expect(result.artifactId).toBe(32);
    expect(result.artifactHead).toBeUndefined();
    expect(warnings[0]).toContain("command run");
    expect(warnings[0]).toContain(HEAD_SHA);
  });

  it("fails with no_artifact when every candidate expired", async () => {
    const noLive = Layer.succeed(
      Gh,
      Gh.of({
        text: (args) =>
          Effect.succeed(
            args[1]?.endsWith("/pulls/7")
              ? pullHead
              : JSON.stringify({ artifacts: [{ id: 1, name: "agentlint-review-7", expired: true, created_at: "x" }] }),
          ),
        binary: () => Effect.die("unreachable"),
      }),
    );
    const layer = Layer.mergeAll(noLive, NodeServices.layer).pipe(Layer.provideMerge(TestEnv));
    const error = await Effect.runPromise(
      prHandler(new PrCommand({ number: 7, repo: "octo/repo" })).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error).toMatchObject({ _tag: "agentlint/PrError", reason: "no_artifact", repo: "octo/repo" });
  });

  it("refuses artifacts that only other branches or repositories uploaded", async () => {
    const foreign = Layer.succeed(
      Gh,
      Gh.of({
        text: (args) =>
          Effect.succeed(
            args[1]?.endsWith("/pulls/7")
              ? pullHead
              : JSON.stringify({
                  artifacts: [
                    {
                      id: 1,
                      name: "agentlint-review-7",
                      expired: false,
                      created_at: "x",
                      workflow_run: { head_branch: "feature/gate", head_repository_id: 666 },
                    },
                    { id: 2, name: "agentlint-review-7", expired: false, created_at: "y" },
                  ],
                }),
          ),
        binary: () => Effect.die("A foreign artifact must not be downloaded"),
      }),
    );
    const layer = Layer.mergeAll(foreign, NodeServices.layer).pipe(Layer.provideMerge(TestEnv));
    const error = await Effect.runPromise(
      prHandler(new PrCommand({ number: 7, repo: "octo/repo" })).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error).toMatchObject({ reason: "foreign_artifact" });
  });

  it("maps a missing gh binary to gh_missing", async () => {
    const missing = Layer.succeed(
      Gh,
      Gh.of({
        text: (args) => Effect.fail(new GhError({ reason: "missing", args: [...args], detail: "ENOENT" })),
        binary: (args) => Effect.fail(new GhError({ reason: "missing", args: [...args], detail: "ENOENT" })),
      }),
    );
    const layer = Layer.mergeAll(missing, NodeServices.layer).pipe(Layer.provideMerge(TestEnv));
    const error = await Effect.runPromise(
      prHandler(new PrCommand({ number: 7, repo: undefined })).pipe(Effect.flip, Effect.provide(layer)),
    );
    expect(error).toMatchObject({ reason: "gh_missing" });
  });
});
