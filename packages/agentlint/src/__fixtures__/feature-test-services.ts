import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { Env } from "../config/env.js";
import { normalizeConfig } from "../domain/config.js";
import { defineRule, type AgentlintRule, type RuleAuthority } from "../domain/rule/model.js";
import { AcceptanceStore } from "../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../shared/infrastructure/config-loader.js";
import { Git } from "../shared/infrastructure/git/service.js";
import { Parser } from "../shared/infrastructure/parser.js";
import { ProposalStore } from "../shared/infrastructure/proposal-store.js";
import { SelectorCache } from "../shared/infrastructure/selector-cache.js";

export const featureTestRule = ({
  id = "security/danger",
  call = "danger",
  authority = "agent",
}: {
  readonly id?: string;
  readonly call?: string;
  readonly authority?: RuleAuthority;
} = {}) =>
  defineRule({
    lifecycle: "state",
    standard: { id, revision: 1, title: `${call} is reviewed`, guidance: `Review ${call} calls.` },
    detector: {
      id: `typescript/${call}-call`,
      version: 1,
      match: { pattern: `${call}($$$ARGS)`, message: `${call} needs judgment` },
    },
    binding: { id, authority, include: ["src/**/*.ts"] },
  });

export const featureTestLayer = ({
  cwd,
  rules,
  actor = "agent:test",
}: {
  readonly cwd: string;
  readonly rules: ReadonlyArray<AgentlintRule>;
  readonly actor?: string;
}) =>
  Layer.mergeAll(
    Layer.succeed(ConfigLoader, ConfigLoader.of({ load: () => Effect.succeed(normalizeConfig({ rules })) })),
    Layer.succeed(
      Git,
      Git.of({
        detectDefaultBranch: () => Effect.succeed("main"),
        changedFiles: () => Effect.succeed([]),
        changeSet: () => Effect.succeed({ baseline: { kind: "git", ref: "main" }, files: [] }),
      }),
    ),
    Parser.layer,
    AcceptanceStore.layer,
    ProposalStore.layer,
    SelectorCache.layer,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(
          Env,
          Env.of({ cwd, argv: [], actor, platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
        ),
      ),
    ),
  );
