import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Schema } from "effect";
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
  version: 2,
  state: {
    version: 2,
    sources: {},
    coverage: { scope: "complete", files: [], rules: [] },
    mode: "review",
    transport: "detached",
    project: "demo",
    base: "main",
    generatedAt: "2026-08-29T10:00:00.000Z",
    applications: [],
    findings: [],
    detached: { source: "agentlint-review.json", canPersistAcceptances: false },
  },
};

const listing = JSON.stringify({
  artifacts: [
    { id: 11, name: "agentlint-review-42", expired: true, created_at: "2026-08-30T10:00:00Z" },
    { id: 12, name: "agentlint-review-42", expired: false, created_at: "2026-08-28T10:00:00Z" },
    { id: 13, name: "agentlint-review-42", expired: false, created_at: "2026-08-29T10:00:00Z" },
  ],
});

const stubGh = (calls: string[][], zip: Uint8Array) =>
  Layer.succeed(
    Gh,
    Gh.of({
      text: (args) => {
        calls.push([...args]);
        if (args[0] === "repo") return Effect.succeed("octo/repo\n");
        if (args[1]?.includes("actions/artifacts?name=")) return Effect.succeed(listing);
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
  it("downloads the newest live artifact, extracts the review JSON, and decodes it", async () => {
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

  it("fails with no_artifact when every candidate expired", async () => {
    const noLive = Layer.succeed(
      Gh,
      Gh.of({
        text: () =>
          Effect.succeed(
            JSON.stringify({ artifacts: [{ id: 1, name: "agentlint-review-7", expired: true, created_at: "x" }] }),
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
