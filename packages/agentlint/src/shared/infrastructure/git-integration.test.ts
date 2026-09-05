import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { normalizeChangeFixture } from "../pipeline/rule-tester.js";
import { Git } from "./git.js";

it("matches compact fixture evidence against real staged, unstaged, and untracked Git changes", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "agentlint-git-evidence-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      { cwd, windowsHide: true, stdio: "pipe" },
    );
  const before = { "migration.sql": "DROP TABLE legacy;\nSELECT 1;\n", "removed.ts": "old();\n" };
  const after = { "migration.sql": "DROP TABLE legacy;\nSELECT 2;\n", "new.ts": "newCall();\n" };
  try {
    git("init", "-b", "main");
    for (const [file, content] of Object.entries(before)) writeFileSync(join(cwd, file), content);
    git("add", ".");
    git("commit", "-m", "test: seed evidence fixture");
    writeFileSync(join(cwd, "migration.sql"), "DROP TABLE legacy;\nSELECT 0;\n");
    git("add", "migration.sql");
    for (const [file, content] of Object.entries(after)) writeFileSync(join(cwd, file), content);
    rmSync(join(cwd, "removed.ts"));
    const TestEnv = Layer.succeed(
      Env,
      Env.of({
        cwd,
        argv: [],
        actor: "agent:test",
        platform: "test",
        noColor: true,
        isTTY: false,
        setExitCode: () => {},
      }),
    );
    const layer = Git.layer.pipe(Layer.provide(NodeServices.layer), Layer.provide(TestEnv));
    const actual = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* Git).changeSet("main");
      }).pipe(Effect.provide(layer)),
    );
    const fixture = normalizeChangeFixture({ before, after });
    expect(actual.files).toEqual(fixture.files);
    const migration = actual.files.find((file) => file.path === "migration.sql");
    expect(migration?.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.kind === "addition")).toEqual([
      { kind: "addition", content: "SELECT 2;" },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
