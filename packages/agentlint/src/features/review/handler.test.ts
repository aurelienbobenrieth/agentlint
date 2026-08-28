import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineRule } from "../../domain/rule.js";
import { AcceptanceStore } from "../../shared/infrastructure/acceptance-store.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { ProposalStore } from "../../shared/infrastructure/proposal-store.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { buildReviewPayload } from "./handler.js";

const cwd = join(tmpdir(), "agentlint-v02-review-payload-test");
const source = 'export const result =\n  danger("x")\n';
const rule = defineRule({
  lifecycle: "state",
  standard: { id: "security/danger", revision: 1, title: "Danger is reviewed", guidance: "Review danger calls." },
  detector: {
    id: "typescript/danger-call",
    version: 1,
    match: { pattern: "danger($$$ARGS)", message: "danger needs judgment" },
  },
  binding: { id: "security/danger", authority: "agent", include: ["src/**/*.ts"] },
});
const TestEnv = Layer.succeed(
  Env,
  Env.of({ cwd, argv: [], actor: "agent:test", platform: "test", noColor: true, isTTY: false, setExitCode: () => {} }),
);
const TestConfig = Layer.succeed(ConfigLoader, ConfigLoader.of({ load: () => Effect.succeed({ rules: [rule] }) }));
const TestGit = Layer.succeed(
  Git,
  Git.of({
    detectDefaultBranch: () => Effect.succeed("main"),
    changedFiles: () => Effect.succeed([]),
    changeSet: () => Effect.succeed({ baseline: { kind: "git", ref: "main" }, files: [] }),
    showFile: () => Effect.succeed(undefined),
  }),
);
const TestLayer = Layer.mergeAll(
  TestConfig,
  TestGit,
  Parser.layer,
  AcceptanceStore.layer,
  ProposalStore.layer,
  SelectorCache.layer,
).pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(TestEnv));

const cleanup = Effect.gen(function* () {
  yield* (yield* FileSystem.FileSystem).remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
}).pipe(Effect.provide(TestLayer));

afterEach(() => Effect.runPromise(cleanup));

describe("review payload", () => {
  it("includes the complete source and the detector-selected focus range", async () => {
    await Effect.runPromise(cleanup);
    await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.resolve(cwd, "src"), { recursive: true });
        yield* fs.writeFileString(path.resolve(cwd, "src", "demo.ts"), source);
      }).pipe(Effect.provide(TestLayer)),
    );

    const payload = await Effect.runPromise(
      buildReviewPayload({
        mode: "review",
        transport: "attached",
        applications: [{ id: "vscode", label: "VS Code" }],
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]?.code).toEqual({
      source,
      focus: { startLine: 2, startColumn: 3, endLine: 2, endColumn: 14 },
    });
    expect(payload.findings[0]?.editor).toEqual({ canOpen: true });
    expect(payload.applications).toEqual([{ id: "vscode", label: "VS Code" }]);
    expect(payload.findings[0]?.guidance).toMatchObject({
      summary: null,
      standard: "Review danger calls.",
      checks: [],
      examples: [],
    });

    const detached = await Effect.runPromise(
      buildReviewPayload({ mode: "review", transport: "detached", source: "review.json" }).pipe(
        Effect.provide(TestLayer),
      ),
    );
    expect(detached.findings[0]?.editor).toBeNull();
    expect(detached.applications).toEqual([]);
  });
});
