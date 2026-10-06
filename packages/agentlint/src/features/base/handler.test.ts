import { Effect } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "@effect/vitest";
import { featureTestLayer } from "../../__fixtures__/feature-test-services.js";
import { baseHandler } from "./handler.js";
import { BaseCommand } from "./request.js";

const layer = ({ tracked }: { readonly tracked?: string } = {}) =>
  featureTestLayer({
    cwd: join(tmpdir(), "agentlint-base-test"),
    rules: [],
    git: {
      trackedBase: () => Effect.succeed(tracked),
      baseline: (baseRef = "origin/main") => Effect.succeed({ ref: baseRef, commit: `${baseRef}@merge-base` }),
    },
  });

it.effect("answers the ref a check compares against, its merge base, and where the ref came from", () =>
  Effect.gen(function* () {
    expect(yield* baseHandler(new BaseCommand({ base: undefined })).pipe(Effect.provide(layer()))).toMatchObject({
      ref: "origin/main",
      commit: "origin/main@merge-base",
      source: "default",
    });
    expect(
      yield* baseHandler(new BaseCommand({ base: undefined })).pipe(Effect.provide(layer({ tracked: "parent" }))),
    ).toMatchObject({ ref: "parent", commit: "parent@merge-base", source: "upstream" });
    expect(
      yield* baseHandler(new BaseCommand({ base: "release" })).pipe(Effect.provide(layer({ tracked: "parent" }))),
    ).toMatchObject({ ref: "release", commit: "release@merge-base", source: "--base" });
  }),
);
