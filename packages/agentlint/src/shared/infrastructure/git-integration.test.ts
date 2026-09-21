import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { Env } from "../../config/env.js";
import { normalizeChangeFixture } from "../pipeline/change-fixture.js";
import { Git } from "./git.js";

interface Repository {
  readonly cwd: string;
  git(...args: string[]): string;
  write(file: string, content: string | Uint8Array): void;
  run<A, E>(use: (git: Git["Service"]) => Effect.Effect<A, E>, layer?: Layer.Layer<FileSystem.FileSystem>): Promise<A>;
}

/**
 * A throwaway repository with one seed commit on `main`.
 */
async function withRepository(seed: Record<string, string>, body: (repository: Repository) => Promise<void>) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "agentlint-git-")));
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
      { cwd, windowsHide: true, stdio: "pipe", encoding: "utf8" },
    ).trim();
  const write = (file: string, content: string | Uint8Array) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
  };
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
  const run: Repository["run"] = (use, fileSystem) =>
    Effect.runPromise(
      Effect.flatMap(Git, use).pipe(
        Effect.provide(Git.layer),
        Effect.provide(fileSystem ?? Layer.empty),
        Effect.provide(NodeServices.layer),
        Effect.provide(TestEnv),
      ),
    );
  try {
    git("init", "-b", "main");
    for (const [file, content] of Object.entries(seed)) write(file, content);
    git("add", ".");
    git("commit", "--allow-empty", "-m", "test: seed");
    await body({ cwd, git, write, run });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

it("matches compact fixture evidence against real staged, unstaged, and untracked Git changes", async () => {
  const before = { "migration.sql": "DROP TABLE legacy;\nSELECT 1;\n", "removed.ts": "old();\n" };
  const after = { "migration.sql": "DROP TABLE legacy;\nSELECT 2;\n", "new.ts": "newCall();\n" };
  await withRepository(before, async ({ cwd, git, write, run }) => {
    write("migration.sql", "DROP TABLE legacy;\nSELECT 0;\n");
    git("add", "migration.sql");
    for (const [file, content] of Object.entries(after)) write(file, content);
    rmSync(join(cwd, "removed.ts"));
    const actual = await run((service) => service.changeSet("main"));
    const fixture = normalizeChangeFixture({ before, after });
    expect(actual.files).toEqual(fixture.files);
    const migration = actual.files.find((file) => file.path === "migration.sql");
    expect(migration?.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.kind === "addition")).toEqual([
      { kind: "addition", content: "SELECT 2;" },
    ]);
  });
});

it("diffs a bracketed route file as one literal path", async () => {
  const seed = { "pages/[id].tsx": "a\n", "pages/i.tsx": "a\n", "pages/d.tsx": "a\n" };
  await withRepository(seed, async ({ write, run }) => {
    write("pages/[id].tsx", "a\nroute\n");
    write("pages/i.tsx", "a\ni\n");
    write("pages/d.tsx", "a\nd\n");
    const change = await run((service) => service.changeSet("main"));
    const additions = Object.fromEntries(
      change.files.map((file) => [
        file.path,
        file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind === "addition").map((line) => line.content)),
      ]),
    );
    expect(additions).toEqual({ "pages/[id].tsx": ["route"], "pages/d.tsx": ["d"], "pages/i.tsx": ["i"] });
  });
});

it("leaves a submodule out of the change set and the changed files", async () => {
  await withRepository({ "a.ts": "a();\n" }, async ({ cwd, git, write, run }) => {
    git("update-index", "--add", "--cacheinfo", `160000,${git("rev-parse", "HEAD")},vendor/sub`);
    mkdirSync(join(cwd, "vendor", "sub"), { recursive: true });
    write("a.ts", "a();\nb();\n");
    expect((await run((service) => service.changeSet("main"))).files.map((file) => file.path)).toEqual(["a.ts"]);
    expect(await run((service) => service.changedFiles("main"))).toEqual(["a.ts"]);
  });
});

it("snapshots a symbolic link as its target text without following it", async () => {
  await withRepository({ "a.ts": "a();\n" }, async ({ cwd, run }) => {
    const outside = mkdtempSync(join(tmpdir(), "agentlint-git-outside-"));
    try {
      writeFileSync(join(outside, "secret.ts"), "SECRET\n");
      try {
        symlinkSync(join(outside, "secret.ts"), join(cwd, "leak.ts"), "file");
        symlinkSync(outside, join(cwd, "linked-dir"), "dir");
      } catch (error) {
        // Windows without the symbolic link privilege cannot build this layout.
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
      const change = await run((service) => service.changeSet("main"));
      expect(change.files.map((file) => file.path)).toEqual(["leak.ts", "linked-dir"]);
      for (const file of change.files) {
        expect(file.after?.content).not.toContain("SECRET");
        expect(file.after?.content).toContain("agentlint-git-outside-");
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

it("never reads or diffs a file the caller excluded, and keeps a binary file without content", async () => {
  await withRepository({ "a.ts": "a();\n" }, async ({ write, run }) => {
    write("assets/huge.bin", "x".repeat(1024));
    write("assets/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2]));
    write("a.ts", "a();\nb();\n");
    const read: string[] = [];
    const recording = Layer.effect(
      FileSystem.FileSystem,
      Effect.map(FileSystem.FileSystem, (real) =>
        FileSystem.makeNoop({
          ...real,
          readFileString: (file, encoding) => {
            read.push(file.replace(/\\/g, "/"));
            return real.readFileString(file, encoding);
          },
        }),
      ),
    ).pipe(Layer.provide(NodeServices.layer));
    const change = await run((service) => service.changeSet("main", (file) => file !== "assets/huge.bin"), recording);
    expect(change.files.map((file) => file.path)).toEqual(["a.ts", "assets/logo.png"]);
    expect(read.some((file) => file.endsWith("assets/huge.bin"))).toBe(false);
    const logo = change.files.find((file) => file.path === "assets/logo.png");
    expect(logo?.after?.content).toBeUndefined();
    expect(logo?.after?.digest).toMatch(/^git-blob:[0-9a-f]{40}$/);
    expect(logo?.hunks).toEqual([]);
  });
});

it("keeps a working file larger than the snapshot limit without loading its content", async () => {
  await withRepository({ "a.ts": "a();\n" }, async ({ cwd, run }) => {
    mkdirSync(join(cwd, "assets"), { recursive: true });
    const largePath = join(cwd, "assets", "large.bin");
    writeFileSync(largePath, "");
    truncateSync(largePath, 64 * 1024 * 1024 + 1);

    const change = await run((service) => service.changeSet("main"));
    const large = change.files.find((file) => file.path === "assets/large.bin");
    expect(large?.after?.content).toBeUndefined();
    expect(large?.after?.digest).toMatch(/^git-blob:[0-9a-f]{40}$/);
    expect(large?.hunks).toEqual([]);
  });
});

it("gives CRLF and LF checkouts the same snapshot", async () => {
  await withRepository({ "a.ts": "one();\ntwo();\n" }, async ({ write, run }) => {
    write("a.ts", "one();\nthree();\n");
    const lf = await run((service) => service.changeSet("main"));
    write("a.ts", "one();\r\nthree();\r\n");
    const crlf = await run((service) => service.changeSet("main"));
    expect(crlf.files[0]?.after).toEqual(lf.files[0]?.after);
    expect(crlf.files[0]?.after?.content).toBe("one();\nthree();\n");
  });
});

it("lists tracked and unignored files for a complete scan, and nothing Git ignores", async () => {
  await withRepository({ "src/dist/x.ts": "x();\n", ".gitignore": "build/\n" }, async ({ cwd, write, run }) => {
    write("build/x.ts", "ignored();\n");
    write("src/new.ts", "untracked();\n");
    rmSync(join(cwd, "src/dist/x.ts"));
    write("src/dist/y.ts", "y();\n");
    const listed = await run((service) => service.listFiles?.() ?? Effect.succeed(undefined));
    expect([...(listed ?? [])].toSorted()).toEqual([".gitignore", "src/dist/x.ts", "src/dist/y.ts", "src/new.ts"]);
  });
});

it("answers undefined instead of failing when the directory is not a repository", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "agentlint-git-none-")));
  try {
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
    const listed = await Effect.runPromise(
      Effect.flatMap(Git, (service) => service.listFiles?.() ?? Effect.succeed([])).pipe(
        Effect.provide(Git.layer),
        Effect.provide(NodeServices.layer),
        Effect.provide(TestEnv),
      ),
    );
    expect(listed).toBeUndefined();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

it("rejects a base that Git would read as an option", async () => {
  await withRepository({ "a.ts": "a();\n" }, async ({ run }) => {
    const error = await run((service) => Effect.flip(service.changedFiles("--output=/tmp/owned")));
    expect(error).toMatchObject({ reason: "unsafe_ref", ref: "--output=/tmp/owned" });
  });
});

it("explains a shallow clone and a missing default branch", async () => {
  await withRepository({ "a.ts": "a();\n" }, async ({ cwd, git, write, run }) => {
    write("a.ts", "a();\nb();\n");
    git("commit", "-am", "test: second");
    const clone = realpathSync(mkdtempSync(join(tmpdir(), "agentlint-git-shallow-")));
    try {
      execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${cwd.replace(/\\/g, "/")}`, "."], {
        cwd: clone,
        windowsHide: true,
        stdio: "pipe",
      });
      const TestEnv = Layer.succeed(
        Env,
        Env.of({
          cwd: clone,
          argv: [],
          actor: "agent:test",
          platform: "test",
          noColor: true,
          isTTY: false,
          setExitCode: () => {},
        }),
      );
      const shallow = await Effect.runPromise(
        Effect.flatMap(Git, (service) => Effect.flip(service.changedFiles("HEAD~1"))).pipe(
          Effect.provide(Git.layer),
          Effect.provide(NodeServices.layer),
          Effect.provide(TestEnv),
        ),
      );
      expect(shallow.message).toBe(
        "No merge base for HEAD and HEAD~1: this is a shallow clone. Fetch full history (actions/checkout fetch-depth: 0) or pass --base.",
      );
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }

    git("branch", "-m", "main", "trunk");
    const missing = await run((service) => Effect.flip(service.detectDefaultBranch()));
    expect(missing).toMatchObject({ reason: "no_default_branch" });
    expect(missing.message).toContain('Pass --base <ref> or set "base" in .agentlint/config.ts');
  });
});
