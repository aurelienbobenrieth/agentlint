import { Effect, Layer } from "effect";
import { expect, it } from "@effect/vitest";
import { Env } from "../../config/env.js";
import { normalizeConfig } from "../../domain/config.js";
import { ConfigLoader } from "../infrastructure/config-loader.js";
import { Git } from "../infrastructure/git/service.js";
import { selectBase } from "./base.js";

const sources = ({
  variable,
  configured,
  tracked,
}: {
  readonly variable?: string;
  readonly configured?: string;
  readonly tracked?: string;
}) =>
  Layer.mergeAll(
    Layer.succeed(
      Env,
      Env.of({
        cwd: ".",
        argv: [],
        actor: "agent:test",
        platform: "test",
        noColor: true,
        isTTY: false,
        setExitCode: () => {},
        ...(variable === undefined ? {} : { base: variable }),
      }),
    ),
    Layer.succeed(
      ConfigLoader,
      ConfigLoader.of({
        load: () => Effect.succeed(normalizeConfig(configured === undefined ? {} : { base: configured })),
      }),
    ),
    Layer.succeed(
      Git,
      Git.of({
        detectDefaultBranch: () => Effect.succeed("main"),
        trackedBase: () => Effect.succeed(tracked),
        baseline: () => Effect.die("unused"),
        changedFiles: () => Effect.die("unused"),
        changeSet: () => Effect.die("unused"),
      }),
    ),
  );

const every = { variable: "env/base", configured: "config/base", tracked: "feature/parent" };

it.effect("takes --base, then AGENTLINT_BASE, then the config, then the tracked branch", () =>
  Effect.gen(function* () {
    expect(yield* selectBase("flag/base").pipe(Effect.provide(sources(every)))).toEqual({
      ref: "flag/base",
      source: "--base",
    });
    expect(yield* selectBase(undefined).pipe(Effect.provide(sources(every)))).toEqual({
      ref: "env/base",
      source: "AGENTLINT_BASE",
    });
    const { variable: _variable, ...withoutVariable } = every;
    expect(yield* selectBase(undefined).pipe(Effect.provide(sources(withoutVariable)))).toEqual({
      ref: "config/base",
      source: "config",
    });
    expect(yield* selectBase(undefined).pipe(Effect.provide(sources({ tracked: every.tracked })))).toEqual({
      ref: "feature/parent",
      source: "upstream",
    });
  }),
);

it.effect("leaves the default branch to Git when nothing names a base", () =>
  Effect.gen(function* () {
    expect(yield* selectBase(undefined).pipe(Effect.provide(sources({})))).toBeUndefined();
  }),
);
