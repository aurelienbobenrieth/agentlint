import { Effect, FileSystem, Layer } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { randomUUID } from "node:crypto";
import { symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { defineConfig, defineRule } from "../../index.js";
import { ConfigLoader } from "../../shared/infrastructure/config-loader.js";
import { Git } from "../../shared/infrastructure/git.js";
import { LedgerStore } from "../../shared/infrastructure/ledger-store.js";
import { NotesStore } from "../../shared/infrastructure/notes-store.js";
import { Parser } from "../../shared/infrastructure/parser.js";
import { SelectorCache } from "../../shared/infrastructure/selector-cache.js";
import { checkHandler } from "../check/handler.js";
import { CheckCommand } from "../check/request.js";
import { resolveHandler } from "../resolve/handler.js";
import { ResolveCommand } from "../resolve/request.js";
import { approveHandler } from "./handler.js";
import { ApproveCommand } from "./request.js";

const REPO_ROOT = process.cwd();

const commentRule = defineRule({
  id: "comments/no-noise",
  description: "Flags comments.",
  guidance: "Comments should add durable context.",
  createOnce(context) {
    return {
      comment(node) {
        context.report({ node, message: "Comment should be evaluated." });
      },
    };
  },
});

const config = defineConfig({
  rules: { "comments/no-noise": commentRule },
  policy: { "comments/no-noise": { resolution: "human" } },
  files: ["src/**/*.ts"],
});

function testLayer(cwd: string, actor: string) {
  const TestEnv = Layer.succeed(
    Env,
    Env.of({
      cwd,
      argv: [],
      actor,
      platform: "test",
      noColor: true,
      isTTY: false,
      setExitCode: () => {},
      readStdin: () => Promise.resolve(""),
    }),
  );

  const TestConfigLoader = Layer.succeed(ConfigLoader, ConfigLoader.of({ load: () => Effect.succeed(config) }));

  const TestGit = Layer.succeed(
    Git,
    Git.of({
      detectDefaultBranch: () => Effect.succeed("main"),
      changedFiles: () => Effect.succeed(["src/sample.ts"]),
      showFile: () => Effect.succeed(undefined),
    }),
  );

  return Layer.mergeAll(
    TestConfigLoader,
    Parser.layer,
    TestGit,
    LedgerStore.layer,
    NotesStore.layer,
    SelectorCache.layer,
  ).pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(TestEnv));
}

function setup(cwd: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(join(cwd, "src"), { recursive: true });
    yield* Effect.tryPromise({
      try: () => symlink(join(REPO_ROOT, "node_modules"), join(cwd, "node_modules"), "junction"),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));
    yield* fs.writeFileString(join(cwd, "src", "sample.ts"), "export const value = 1;\n// durable context\n");
  });
}

function cleanup(cwd: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(cwd, { recursive: true }).pipe(Effect.orElseSucceed(() => {}));
  });
}

const check = (ci = false) =>
  checkHandler(new CheckCommand({ all: true, rules: [], base: undefined, files: [], format: "text", ci }));

describe("approval workflow", () => {
  it("walks the full human-gated loop: refuse accept, request, block CI, approve, unblock", async () => {
    const cwd = join(tmpdir(), `agentlint-approve-${randomUUID()}`);
    const agentLayer = testLayer(cwd, "agent:test");
    const humanLayer = testLayer(cwd, "human:tester");

    try {
      await Effect.runPromise(setup(cwd).pipe(Effect.provide(agentLayer)));

      // Unresolved finding blocks locally.
      const first = await Effect.runPromise(check().pipe(Effect.provide(agentLayer)));
      expect(first.exitCode).toBe(1);
      const [finding] = first.findings;
      expect(finding).toBeDefined();
      if (!finding) return;

      // Agents cannot accept a human-gated finding.
      const refused = await Effect.runPromise(
        resolveHandler(
          new ResolveCommand({
            selector: finding.hash,
            status: "accepted",
            reason: "agent says fine",
            actor: undefined,
            interactive: false,
          }),
        ).pipe(Effect.provide(agentLayer)),
      );
      expect(refused.exitCode).toBe(2);
      expect(refused.message).toContain("requires human approval");

      // Requesting approval unblocks locally but blocks CI.
      const requested = await Effect.runPromise(
        resolveHandler(
          new ResolveCommand({
            selector: finding.hash,
            status: "approval_requested",
            reason: "Comment documents the invariant.",
            actor: undefined,
            interactive: false,
          }),
        ).pipe(Effect.provide(agentLayer)),
      );
      expect(requested.exitCode).toBe(0);

      const local = await Effect.runPromise(check(false).pipe(Effect.provide(agentLayer)));
      const ci = await Effect.runPromise(check(true).pipe(Effect.provide(agentLayer)));
      expect(local.exitCode).toBe(0);
      expect(local.pendingApprovalCount).toBe(1);
      expect(ci.exitCode).toBe(1);

      // Agent actors cannot approve.
      const agentApprove = await Effect.runPromise(
        approveHandler(new ApproveCommand({ selector: finding.hash, reason: "self-approve", actor: undefined })).pipe(
          Effect.provide(agentLayer),
        ),
      );
      expect(agentApprove.exitCode).toBe(2);
      expect(agentApprove.message).toContain("reserved for humans");

      // A human approval unblocks CI.
      const humanApprove = await Effect.runPromise(
        approveHandler(
          new ApproveCommand({
            selector: finding.hash,
            reason: "Reviewed - the comment is load-bearing.",
            actor: undefined,
          }),
        ).pipe(Effect.provide(humanLayer)),
      );
      expect(humanApprove.exitCode).toBe(0);

      const after = await Effect.runPromise(check(true).pipe(Effect.provide(agentLayer)));
      expect(after.exitCode).toBe(0);
      expect(after.pendingApprovalCount).toBe(0);
    } finally {
      await Effect.runPromise(cleanup(cwd).pipe(Effect.provide(agentLayer)));
    }
  });
});
